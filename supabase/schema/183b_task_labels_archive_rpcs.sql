-- 183b: Labels + archive RPCs — apply after 183a.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_task_labels()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_operational_task_area_manager()
    or public.normalize_profile_role(public.current_profile_role()) in ('admin', 'gerente_general', 'gerente');
$$;

create or replace function public.task_labels_for_task(p_task_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color_key', l.color_key,
      'scope', l.scope,
      'area_id', l.area_id
    )
    order by l.name
  ), '[]'::jsonb)
  from public.task_label_assignments tla
  join public.task_labels l on l.id = tla.label_id
  where tla.task_id = p_task_id
    and l.deleted_at is null
    and l.archived_at is null;
$$;

create or replace function public.get_operational_task_permissions(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'can_view', public.can_access_operational_task(p_task, 'view'),
    'can_edit', public.can_mutate_operational_task(p_task),
    'can_assign', public.can_manage_operational_task_members(p_task),
    'can_move', public.can_mutate_operational_task(p_task),
    'manage_members', public.can_manage_operational_task_members(p_task),
    'manage_watchers', public.can_manage_operational_task_watchers(p_task),
    'watch_self', public.can_access_operational_task(p_task, 'view'),
    'is_watching', public.is_operational_task_watcher(p_task.id, auth.uid()),
    'manage_work_plan', public.can_manage_task_work_plan(p_task),
    'complete_steps', public.can_mutate_operational_task(p_task),
    'assign_steps', public.can_mutate_operational_task(p_task),
    'upload_attachments', public.can_upload_task_files(p_task),
    'comment', public.can_comment_on_task(p_task),
    'submit_evidence', public.can_submit_task_evidence(p_task),
    'verify_evidence', public.is_operational_task_area_manager(),
    'manage_labels', public.can_manage_task_labels(),
    'assign_labels', public.can_mutate_operational_task(p_task),
    'can_archive', (
      public.can_mutate_operational_task(p_task)
      and p_task.archived_at is null
      and p_task.deleted_at is null
    ),
    'can_restore', (
      p_task.archived_at is not null
      and p_task.deleted_at is null
      and (
        public.can_manage_task_labels()
        or p_task.created_by = auth.uid()
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = p_task.id
            and ta.profile_id = auth.uid()
            and ta.status = 'active'
            and ta.assignment_role = 'primary'
        )
      )
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Card summary with labels
-- ---------------------------------------------------------------------------
create or replace function public.operational_task_card_summary(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with work as (
    select public.get_task_work_card_summary(p_task.id) as payload
  )
  select jsonb_build_object(
    'id', p_task.id,
    'title', p_task.title,
    'objective', p_task.objective,
    'expected_result', p_task.expected_result,
    'status', p_task.status,
    'priority', p_task.priority,
    'due_at', p_task.due_at,
    'waiting_reason', p_task.waiting_reason,
    'waiting_unblock_note', p_task.waiting_unblock_note,
    'sort_position', p_task.sort_position,
    'area_id', p_task.area_id,
    'area_name', (select a.name from public.areas a where a.id = p_task.area_id),
    'archived_at', p_task.archived_at,
    'is_overdue', (
      p_task.due_at is not null
      and p_task.due_at < now()
      and p_task.status not in ('completed', 'cancelled')
    ),
    'steps_progress', work.payload -> 'steps_progress',
    'work_summary', work.payload -> 'work_summary',
    'labels', public.task_labels_for_task(p_task.id),
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', ta.profile_id,
          'full_name', coalesce(p.full_name, ''),
          'avatar_url', p.avatar_url,
          'assignment_role', ta.assignment_role
        )
        order by case ta.assignment_role when 'primary' then 0 else 1 end, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id and ta.status = 'active'
    ), '[]'::jsonb),
    'primary_assignee', (
      select jsonb_build_object(
        'profile_id', ta.profile_id,
        'full_name', coalesce(p.full_name, ''),
        'avatar_url', p.avatar_url
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
        and ta.assignment_role = 'primary'
      limit 1
    ),
    'permissions', public.get_operational_task_permissions(p_task)
  )
  from work;
$$;

-- ---------------------------------------------------------------------------
-- Board with label filter
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_tasks_board(
  p_area_id text default null,
  p_assignee_id uuid default null,
  p_search text default null,
  p_include_cancelled boolean default false,
  p_completed_days integer default 7,
  p_include_old_completed boolean default false,
  p_label_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(lower(coalesce(p_search, ''))), '');
  v_completed_days integer := greatest(coalesce(p_completed_days, 7), 1);
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(
    public.operational_task_card_summary(t)
    order by t.sort_position asc, t.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.assigned_tasks t
  where t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
    and public.can_access_operational_task(t, 'view')
    and (p_include_cancelled or t.status <> 'cancelled')
    and (
      t.status <> 'completed'
      or p_include_old_completed
      or t.completed_at >= now() - make_interval(days => v_completed_days)
      or (t.completed_at is null and t.updated_at >= now() - make_interval(days => v_completed_days))
    )
    and (p_area_id is null or t.area_id = p_area_id)
    and (
      p_assignee_id is null
      or exists (
        select 1 from public.task_assignees ta
        where ta.task_id = t.id and ta.profile_id = p_assignee_id and ta.status = 'active'
      )
    )
    and (
      v_search is null
      or lower(t.title) like '%' || v_search || '%'
      or lower(coalesce(t.objective, '')) like '%' || v_search || '%'
      or lower(coalesce(t.expected_result, '')) like '%' || v_search || '%'
      or exists (
        select 1 from public.task_steps s
        where s.task_id = t.id
          and s.deleted_at is null
          and lower(s.text) like '%' || v_search || '%'
      )
    )
    and (
      p_label_ids is null
      or cardinality(p_label_ids) = 0
      or exists (
        select 1 from public.task_label_assignments tla
        where tla.task_id = t.id
          and tla.label_id = any(p_label_ids)
      )
    );

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Detail includes labels
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_task_detail(
  p_task_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_activity jsonb;
  v_created_name text;
begin
  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null;

  if not found then
    raise exception 'Tarea no encontrada.';
  end if;

  if not public.can_access_operational_task(v_task, 'view') then
    raise exception 'No tienes permiso para ver esta tarea.';
  end if;

  select coalesce(p.full_name, 'Sistema') into v_created_name
  from public.profiles p where p.id = v_task.created_by;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'action', l.action,
      'field_name', l.field_name,
      'old_value', l.old_value,
      'new_value', l.new_value,
      'metadata', l.metadata,
      'created_at', l.created_at,
      'actor_name', coalesce(p.full_name, 'Sistema'),
      'icon', public.task_activity_icon(l.action) ->> 'icon',
      'tone', public.task_activity_icon(l.action) ->> 'tone'
    )
    order by l.created_at desc
  ), '[]'::jsonb)
  into v_activity
  from public.task_activity_log l
  left join public.profiles p on p.id = l.actor_id
  where l.task_id = p_task_id
    and l.action not in ('moved', 'updated');

  return public.operational_task_row(v_task)
    || jsonb_build_object(
      'activity', v_activity,
      'created_by_name', v_created_name,
      'permissions', public.get_operational_task_permissions(v_task),
      'is_overdue', (
        v_task.due_at is not null
        and v_task.due_at < now()
        and v_task.status not in ('completed', 'cancelled')
      ),
      'steps_progress', public.get_task_work_plan_progress(p_task_id),
      'work_summary', public.get_task_next_work_step(p_task_id),
      'work_plan', public.task_work_plan_json(p_task_id),
      'open_days', public.task_open_duration_days(v_task),
      'blocked_days', public.task_blocked_duration_days(v_task),
      'labels', public.task_labels_for_task(p_task_id),
      'archived_at', v_task.archived_at,
      'archived_by', v_task.archived_by,
      'attachments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'step_id', a.step_id,
            'attachment_type', a.attachment_type,
            'storage_path', a.storage_path,
            'external_url', a.external_url,
            'display_name', a.display_name,
            'mime_type', a.mime_type,
            'size_bytes', a.size_bytes,
            'uploaded_by', a.uploaded_by,
            'uploaded_by_name', (select p.full_name from public.profiles p where p.id = a.uploaded_by),
            'uploaded_at', a.uploaded_at
          )
          order by a.uploaded_at desc
        )
        from public.task_attachments a
        where a.task_id = p_task_id and a.deleted_at is null
      ), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'step_id', c.step_id,
            'body_markdown', c.body_markdown,
            'mention_profile_ids', c.mention_profile_ids,
            'created_by', c.created_by,
            'created_by_name', (select p.full_name from public.profiles p where p.id = c.created_by),
            'created_by_avatar', (select p.avatar_url from public.profiles p where p.id = c.created_by),
            'created_at', c.created_at
          )
          order by c.created_at asc
        )
        from public.task_comments c
        where c.task_id = p_task_id and c.deleted_at is null
      ), '[]'::jsonb),
      'evidence', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'step_id', e.step_id,
            'evidence_type', e.evidence_type,
            'storage_path', e.storage_path,
            'external_url', e.external_url,
            'display_name', e.display_name,
            'mime_type', e.mime_type,
            'note_text', e.note_text,
            'submitted_by', e.submitted_by,
            'submitted_by_name', (select p.full_name from public.profiles p where p.id = e.submitted_by),
            'submitted_at', e.submitted_at,
            'verified_by', e.verified_by,
            'verified_at', e.verified_at
          )
          order by e.submitted_at desc
        )
        from public.task_evidence e
        where e.task_id = p_task_id and e.deleted_at is null
      ), '[]'::jsonb),
      'recurrence', (
        select jsonb_build_object(
          'id', r.id,
          'frequency', r.frequency,
          'interval_days', r.interval_days,
          'next_run_at', r.next_run_at,
          'enabled', r.enabled
        )
        from public.task_recurrence_rules r
        where r.source_task_id = p_task_id
        limit 1
      )
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Label catalog
-- ---------------------------------------------------------------------------
create or replace function public.get_task_labels_catalog(
  p_area_id text default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'color_key', l.color_key,
      'description', l.description,
      'scope', l.scope,
      'area_id', l.area_id,
      'area_name', (select a.name from public.areas a where a.id = l.area_id)
    )
    order by l.scope, l.name
  ), '[]'::jsonb)
  into v_rows
  from public.task_labels l
  where l.deleted_at is null
    and (p_include_archived or l.archived_at is null)
    and (
      l.scope = 'global'
      or (l.scope = 'area' and (p_area_id is null or l.area_id = p_area_id))
    );

  return jsonb_build_object('labels', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assign labels to task
-- ---------------------------------------------------------------------------
create or replace function public.update_operational_task_labels(
  p_task_id text,
  p_label_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_label uuid;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null
  for update;

  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para editar etiquetas.';
  end if;

  select coalesce(array_agg(tla.label_id order by tla.label_id), '{}'::uuid[])
  into v_old_ids
  from public.task_label_assignments tla
  where tla.task_id = p_task_id;

  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into v_new_ids
  from unnest(coalesce(p_label_ids, '{}'::uuid[])) as value
  where value is not null;

  foreach v_label in array v_new_ids loop
    if not exists (
      select 1 from public.task_labels l
      where l.id = v_label
        and l.deleted_at is null
        and l.archived_at is null
    ) then
      raise exception 'Etiqueta inválida.';
    end if;
  end loop;

  delete from public.task_label_assignments tla
  where tla.task_id = p_task_id
    and not (tla.label_id = any(v_new_ids));

  insert into public.task_label_assignments (task_id, label_id, assigned_by)
  select p_task_id, label_id, auth.uid()
  from unnest(v_new_ids) as label_id
  on conflict (task_id, label_id) do nothing;

  if v_old_ids is distinct from v_new_ids then
    perform public.log_task_activity(
      p_task_id,
      'labels_updated',
      'labels',
      to_jsonb(v_old_ids),
      to_jsonb(v_new_ids),
      '{}'::jsonb
    );
  end if;

  return public.get_operational_task_detail(p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Archive / restore
-- ---------------------------------------------------------------------------
create or replace function public.archive_operational_task(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
  for update;

  if not found then raise exception 'Tarea no encontrada o ya archivada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para archivar esta tarea.';
  end if;

  update public.assigned_tasks
  set archived_at = now(),
      archived_by = auth.uid(),
      updated_at = now()
  where id = p_task_id
  returning * into v_task;

  perform public.log_task_activity(
    p_task_id, 'archived', 'archived_at', null, to_jsonb(now()), '{}'::jsonb
  );

  return public.operational_task_card_summary(v_task);
end;
$$;

create or replace function public.restore_operational_task(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_perms jsonb;
  v_old_archived timestamptz;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is not null
  for update;

  if not found then raise exception 'Tarea archivada no encontrada.'; end if;

  v_perms := public.get_operational_task_permissions(v_task);
  if not coalesce((v_perms ->> 'can_restore')::boolean, false) then
    raise exception 'No tienes permiso para restaurar esta tarea.';
  end if;

  v_old_archived := v_task.archived_at;

  update public.assigned_tasks
  set archived_at = null,
      archived_by = null,
      updated_at = now()
  where id = p_task_id
  returning * into v_task;

  perform public.log_task_activity(
    p_task_id, 'restored', 'archived_at', to_jsonb(v_old_archived), null, '{}'::jsonb
  );

  return public.operational_task_card_summary(v_task);
end;
$$;

create or replace function public.get_archived_operational_tasks(
  p_search text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(lower(coalesce(p_search, ''))), '');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if not public.can_manage_task_labels() then
    raise exception 'No tienes permiso para ver tareas archivadas.';
  end if;

  select coalesce(jsonb_agg(
    public.operational_task_card_summary(t)
    order by t.archived_at desc nulls last
  ), '[]'::jsonb)
  into v_rows
  from (
    select t.*
    from public.assigned_tasks t
    where t.task_source = 'operational'
      and t.deleted_at is null
      and t.archived_at is not null
      and public.can_access_operational_task(t, 'view')
      and (
        v_search is null
        or lower(t.title) like '%' || v_search || '%'
        or lower(coalesce(t.objective, '')) like '%' || v_search || '%'
      )
    order by t.archived_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- Activity icons for new actions
create or replace function public.task_activity_icon(p_action text)
returns jsonb
language sql
immutable
as $$
  select case p_action
    when 'created' then '{"icon":"🟢","tone":"success"}'::jsonb
    when 'assignees_updated' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watchers_updated' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watcher_added' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'watcher_removed' then '{"icon":"🔵","tone":"info"}'::jsonb
    when 'status_changed' then '{"icon":"◎","tone":"info"}'::jsonb
    when 'step_completed' then '{"icon":"🟡","tone":"warning"}'::jsonb
    when 'step_uncompleted' then '{"icon":"🟡","tone":"warning"}'::jsonb
    when 'step_list_created' then '{"icon":"📋","tone":"info"}'::jsonb
    when 'step_list_deleted' then '{"icon":"📋","tone":"info"}'::jsonb
    when 'attachment_added' then '{"icon":"📎","tone":"info"}'::jsonb
    when 'attachment_removed' then '{"icon":"📎","tone":"info"}'::jsonb
    when 'comment_added' then '{"icon":"💬","tone":"info"}'::jsonb
    when 'evidence_submitted' then '{"icon":"✅","tone":"success"}'::jsonb
    when 'step_converted' then '{"icon":"↗","tone":"info"}'::jsonb
    when 'labels_updated' then '{"icon":"🏷","tone":"info"}'::jsonb
    when 'archived' then '{"icon":"📦","tone":"muted"}'::jsonb
    when 'restored' then '{"icon":"↩","tone":"success"}'::jsonb
    else '{"icon":"•","tone":"muted"}'::jsonb
  end;
$$;

-- Grants
revoke all on function public.can_manage_task_labels() from public;
revoke all on function public.task_labels_for_task(text) from public;
revoke all on function public.get_task_labels_catalog(text, boolean) from public;
revoke all on function public.update_operational_task_labels(text, uuid[]) from public;
revoke all on function public.archive_operational_task(text) from public;
revoke all on function public.restore_operational_task(text) from public;
revoke all on function public.get_archived_operational_tasks(text, integer) from public;

grant execute on function public.can_manage_task_labels() to authenticated;
grant execute on function public.task_labels_for_task(text) to authenticated;
grant execute on function public.get_task_labels_catalog(text, boolean) to authenticated;
grant execute on function public.update_operational_task_labels(text, uuid[]) to authenticated;
grant execute on function public.archive_operational_task(text) to authenticated;
grant execute on function public.restore_operational_task(text) to authenticated;
grant execute on function public.get_archived_operational_tasks(text, integer) to authenticated;
grant execute on function public.get_operational_tasks_board(text, uuid, text, boolean, integer, boolean, uuid[]) to authenticated;
