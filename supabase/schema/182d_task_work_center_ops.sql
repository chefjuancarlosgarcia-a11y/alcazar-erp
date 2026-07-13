-- 182d: Work plan + attachments + comments + evidence + reminders RPCs.
-- Run after 182c.

-- ---------------------------------------------------------------------------
-- Internal: assert task access
-- ---------------------------------------------------------------------------
create or replace function public.assert_operational_task_mutable(p_task_id text)
returns public.assigned_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
begin
  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null and t.archived_at is null
  for update;
  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para editar esta tarea.';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes editar una tarea cerrada.';
  end if;
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: create list
-- ---------------------------------------------------------------------------
create or replace function public.create_task_step_list(
  p_task_id text,
  p_title text default 'Plan de trabajo',
  p_copy_from_list_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_list_id uuid;
  v_pos numeric;
  v_src record;
  v_step record;
  v_idx int := 0;
begin
  v_task := public.assert_operational_task_mutable(p_task_id);

  select coalesce(max(sl.sort_position), -1024) + 1024 into v_pos
  from public.task_step_lists sl
  where sl.task_id = p_task_id and sl.deleted_at is null;

  insert into public.task_step_lists (task_id, title, sort_position, created_by)
  values (p_task_id, coalesce(nullif(trim(p_title), ''), 'Plan de trabajo'), v_pos, auth.uid())
  returning id into v_list_id;

  if p_copy_from_list_id is not null then
    for v_step in
      select s.*
      from public.task_steps s
      join public.task_step_lists sl on sl.id = s.step_list_id
      where s.step_list_id = p_copy_from_list_id
        and s.deleted_at is null
        and sl.deleted_at is null
        and public.can_access_operational_task(
          (select t from public.assigned_tasks t where t.id = sl.task_id), 'view'
        )
      order by s.sort_position asc
    loop
      insert into public.task_steps (
        step_list_id, task_id, text, sort_position, created_by
      ) values (
        v_list_id, p_task_id, v_step.text, v_idx::numeric * 1024, auth.uid()
      );
      v_idx := v_idx + 1;
    end loop;
  end if;

  perform public.log_task_activity(
    p_task_id, 'step_list_created', 'work_plan', null,
    to_jsonb(coalesce(nullif(trim(p_title), ''), 'Plan de trabajo')),
    jsonb_build_object('list_id', v_list_id)
  );

  return public.get_operational_task_detail(p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: delete list
-- ---------------------------------------------------------------------------
create or replace function public.delete_task_step_list(p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.task_step_lists;
begin
  select * into v_list
  from public.task_step_lists sl
  where sl.id = p_list_id and sl.deleted_at is null
  for update;

  if not found then raise exception 'Lista no encontrada.'; end if;
  perform public.assert_operational_task_mutable(v_list.task_id);

  update public.task_step_lists
  set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where id = p_list_id;

  update public.task_steps
  set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where step_list_id = p_list_id and deleted_at is null;

  perform public.log_task_activity(
    v_list.task_id, 'step_list_deleted', 'work_plan', to_jsonb(v_list.title), null,
    jsonb_build_object('list_id', p_list_id)
  );

  return public.get_operational_task_detail(v_list.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: create step
-- ---------------------------------------------------------------------------
create or replace function public.create_task_step(
  p_list_id uuid,
  p_text text,
  p_sort_position numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.task_step_lists;
  v_pos numeric;
  v_step_id uuid;
begin
  if coalesce(trim(p_text), '') = '' then raise exception 'El paso no puede estar vacío.'; end if;

  select * into v_list
  from public.task_step_lists sl
  where sl.id = p_list_id and sl.deleted_at is null
  for update;

  if not found then raise exception 'Lista no encontrada.'; end if;
  perform public.assert_operational_task_mutable(v_list.task_id);

  if p_sort_position is not null then
    v_pos := p_sort_position;
  else
    select coalesce(max(s.sort_position), -1024) + 1024 into v_pos
    from public.task_steps s
    where s.step_list_id = p_list_id and s.deleted_at is null;
  end if;

  insert into public.task_steps (step_list_id, task_id, text, sort_position, created_by)
  values (p_list_id, v_list.task_id, trim(p_text), v_pos, auth.uid())
  returning id into v_step_id;

  return public.get_operational_task_detail(v_list.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: update step
-- ---------------------------------------------------------------------------
create or replace function public.update_task_step(
  p_step_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
  v_dep uuid;
begin
  select * into v_step
  from public.task_steps s
  where s.id = p_step_id and s.deleted_at is null
  for update;

  if not found then raise exception 'Paso no encontrado.'; end if;
  perform public.assert_operational_task_mutable(v_step.task_id);

  if p_data ? 'depends_on_step_id' then
    v_dep := nullif(p_data ->> 'depends_on_step_id', '')::uuid;
    if v_dep is not null and public.task_step_has_dependency_cycle(p_step_id, v_dep) then
      raise exception 'La dependencia crearía un ciclo.';
    end if;
  end if;

  update public.task_steps
  set text = coalesce(nullif(trim(p_data ->> 'text'), ''), text),
      assigned_profile_id = case
        when p_data ? 'assigned_profile_id' then nullif(p_data ->> 'assigned_profile_id', '')::uuid
        else assigned_profile_id
      end,
      due_at = case
        when p_data ? 'due_at' then nullif(p_data ->> 'due_at', '')::timestamptz
        else due_at
      end,
      depends_on_step_id = case
        when p_data ? 'depends_on_step_id' then nullif(p_data ->> 'depends_on_step_id', '')::uuid
        else depends_on_step_id
      end,
      sort_position = case
        when p_data ? 'sort_position' then (p_data ->> 'sort_position')::numeric
        else sort_position
      end,
      updated_at = now()
  where id = p_step_id;

  if p_data ? 'assigned_profile_id' and nullif(p_data ->> 'assigned_profile_id', '')::uuid is not null then
    perform public.notify_operational_task_event(
      nullif(p_data ->> 'assigned_profile_id', '')::uuid,
      'task_step_assigned',
      'Paso asignado',
      'Te asignaron un paso en la tarea.',
      v_step.task_id
    );
  end if;

  return public.get_operational_task_detail(v_step.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: toggle step
-- ---------------------------------------------------------------------------
create or replace function public.toggle_task_step(
  p_step_id uuid,
  p_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
  v_blocked boolean;
begin
  select * into v_step
  from public.task_steps s
  where s.id = p_step_id and s.deleted_at is null
  for update;

  if not found then raise exception 'Paso no encontrado.'; end if;
  perform public.assert_operational_task_mutable(v_step.task_id);

  if p_completed and v_step.depends_on_step_id is not null then
    select not exists (
      select 1 from public.task_steps dep
      where dep.id = v_step.depends_on_step_id
        and dep.deleted_at is null
        and dep.completed
    ) into v_blocked;
    if v_blocked then
      raise exception 'Completa primero el paso del que depende este.';
    end if;
  end if;

  update public.task_steps
  set completed = p_completed,
      completed_by = case when p_completed then auth.uid() else null end,
      completed_at = case when p_completed then now() else null end,
      updated_at = now()
  where id = p_step_id;

  perform public.log_task_activity(
    v_step.task_id,
    case when p_completed then 'step_completed' else 'step_uncompleted' end,
    'work_plan',
    to_jsonb(v_step.text),
    to_jsonb(p_completed),
    jsonb_build_object('step_id', p_step_id)
  );

  return public.get_operational_task_detail(v_step.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: reorder steps in list
-- ---------------------------------------------------------------------------
create or replace function public.reorder_task_steps(
  p_list_id uuid,
  p_step_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list public.task_step_lists;
  v_idx int;
  v_step_id uuid;
begin
  select * into v_list
  from public.task_step_lists sl
  where sl.id = p_list_id and sl.deleted_at is null
  for update;

  if not found then raise exception 'Lista no encontrada.'; end if;
  perform public.assert_operational_task_mutable(v_list.task_id);

  v_idx := 0;
  foreach v_step_id in array coalesce(p_step_ids, '{}'::uuid[]) loop
    update public.task_steps
    set sort_position = v_idx::numeric * 1024, updated_at = now()
    where id = v_step_id and step_list_id = p_list_id and deleted_at is null;
    v_idx := v_idx + 1;
  end loop;

  return public.get_operational_task_detail(v_list.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: move step between lists
-- ---------------------------------------------------------------------------
create or replace function public.move_task_step(
  p_step_id uuid,
  p_target_list_id uuid,
  p_sort_position numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
  v_target public.task_step_lists;
  v_pos numeric;
begin
  select * into v_step
  from public.task_steps s
  where s.id = p_step_id and s.deleted_at is null
  for update;

  if not found then raise exception 'Paso no encontrado.'; end if;

  select * into v_target
  from public.task_step_lists sl
  where sl.id = p_target_list_id and sl.deleted_at is null;

  if not found then raise exception 'Lista destino no encontrada.'; end if;
  if v_target.task_id <> v_step.task_id then
    raise exception 'No puedes mover pasos entre tareas distintas.';
  end if;

  perform public.assert_operational_task_mutable(v_step.task_id);

  if p_sort_position is not null then
    v_pos := p_sort_position;
  else
    select coalesce(max(s.sort_position), -1024) + 1024 into v_pos
    from public.task_steps s
    where s.step_list_id = p_target_list_id and s.deleted_at is null;
  end if;

  update public.task_steps
  set step_list_id = p_target_list_id,
      sort_position = v_pos,
      updated_at = now()
  where id = p_step_id;

  return public.get_operational_task_detail(v_step.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: delete step
-- ---------------------------------------------------------------------------
create or replace function public.delete_task_step(p_step_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
begin
  select * into v_step
  from public.task_steps s
  where s.id = p_step_id and s.deleted_at is null
  for update;

  if not found then raise exception 'Paso no encontrado.'; end if;
  perform public.assert_operational_task_mutable(v_step.task_id);

  update public.task_steps
  set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where id = p_step_id;

  return public.get_operational_task_detail(v_step.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Work plan: convert step to task
-- ---------------------------------------------------------------------------
create or replace function public.convert_task_step_to_task(p_step_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
  v_task public.assigned_tasks;
  v_new_id text;
  v_primary uuid;
begin
  select * into v_step
  from public.task_steps s
  where s.id = p_step_id and s.deleted_at is null
  for update;

  if not found then raise exception 'Paso no encontrado.'; end if;
  v_task := public.assert_operational_task_mutable(v_step.task_id);

  select ta.profile_id into v_primary
  from public.task_assignees ta
  where ta.task_id = v_step.task_id
    and ta.status = 'active'
    and ta.assignment_role = 'primary'
  limit 1;

  v_new_id := 'opt-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.assigned_tasks (
    id, title, objective, task_source, status, priority, area_id, created_by, assigned_by
  ) values (
    v_new_id,
    v_step.text,
    v_step.text,
    'operational',
    'pending',
    v_task.priority,
    v_task.area_id,
    auth.uid(),
    auth.uid()
  );

  if v_primary is not null then
    insert into public.task_assignees (task_id, profile_id, assignment_role, assigned_by)
    values (v_new_id, v_primary, 'primary', auth.uid());
    perform public.sync_assigned_tasks_profile_ids(v_new_id);
  end if;

  update public.task_steps
  set converted_task_id = v_new_id, updated_at = now()
  where id = p_step_id;

  perform public.log_task_activity(
    v_step.task_id, 'step_converted', 'work_plan', to_jsonb(v_step.text),
    to_jsonb(v_new_id), jsonb_build_object('step_id', p_step_id)
  );

  return jsonb_build_object(
    'source_task', public.get_operational_task_detail(v_step.task_id),
    'new_task_id', v_new_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create or replace function public.register_task_attachment(
  p_task_id text,
  p_step_id uuid default null,
  p_storage_path text default null,
  p_display_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_external_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_type text;
  v_id uuid;
begin
  v_task := public.assert_operational_task_mutable(p_task_id);
  if not public.can_upload_task_files(v_task) then
    raise exception 'No tienes permiso para subir archivos.';
  end if;

  if coalesce(trim(p_external_url), '') <> '' then
    v_type := 'external_link';
  else
    v_type := 'file';
    if coalesce(trim(p_storage_path), '') = '' then
      raise exception 'Ruta de archivo obligatoria.';
    end if;
  end if;

  insert into public.task_attachments (
    task_id, step_id, attachment_type, storage_path, external_url,
    display_name, mime_type, size_bytes, uploaded_by
  ) values (
    p_task_id,
    p_step_id,
    v_type,
    nullif(trim(p_storage_path), ''),
    nullif(trim(p_external_url), ''),
    coalesce(nullif(trim(p_display_name), ''), 'Archivo'),
    nullif(trim(p_mime_type), ''),
    p_size_bytes,
    auth.uid()
  ) returning id into v_id;

  perform public.log_task_activity(
    p_task_id, 'attachment_added', 'attachments',
    null, to_jsonb(coalesce(nullif(trim(p_display_name), ''), 'Archivo')),
    jsonb_build_object('attachment_id', v_id, 'step_id', p_step_id)
  );

  return public.get_operational_task_detail(p_task_id);
end;
$$;

create or replace function public.delete_task_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_att public.task_attachments;
begin
  select * into v_att
  from public.task_attachments a
  where a.id = p_attachment_id and a.deleted_at is null
  for update;

  if not found then raise exception 'Adjunto no encontrado.'; end if;
  perform public.assert_operational_task_mutable(v_att.task_id);

  update public.task_attachments
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_attachment_id;

  perform public.log_task_activity(
    v_att.task_id, 'attachment_removed', 'attachments',
    to_jsonb(v_att.display_name), null,
    jsonb_build_object('attachment_id', p_attachment_id)
  );

  return public.get_operational_task_detail(v_att.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create or replace function public.create_task_comment(
  p_task_id text,
  p_body text,
  p_step_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_body text := trim(coalesce(p_body, ''));
  v_mentions uuid[];
  v_comment_id uuid;
  v_mention uuid;
begin
  if v_body = '' then raise exception 'El comentario no puede estar vacío.'; end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null;

  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_comment_on_task(v_task) then
    raise exception 'No tienes permiso para comentar.';
  end if;

  v_mentions := public.parse_task_comment_mentions(p_task_id, v_body);

  insert into public.task_comments (
    task_id, step_id, body_markdown, mention_profile_ids, created_by
  ) values (
    p_task_id, p_step_id, v_body, coalesce(v_mentions, '{}'::uuid[]), auth.uid()
  ) returning id into v_comment_id;

  perform public.log_task_activity(
    p_task_id, 'comment_added', 'comments',
    null, to_jsonb(left(v_body, 120)),
    jsonb_build_object('comment_id', v_comment_id, 'step_id', p_step_id)
  );

  foreach v_mention in array coalesce(v_mentions, '{}'::uuid[]) loop
    perform public.notify_operational_task_event(
      v_mention,
      'task_mention',
      'Te mencionaron en una tarea',
      left(v_body, 200),
      p_task_id
    );
  end loop;

  return public.get_operational_task_detail(p_task_id);
end;
$$;

create or replace function public.delete_task_comment(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.task_comments;
begin
  select * into v_comment
  from public.task_comments c
  where c.id = p_comment_id and c.deleted_at is null
  for update;

  if not found then raise exception 'Comentario no encontrado.'; end if;

  if v_comment.created_by <> auth.uid()
    and not public.is_operational_task_area_manager() then
    raise exception 'No puedes eliminar este comentario.';
  end if;

  update public.task_comments set deleted_at = now() where id = p_comment_id;

  return public.get_operational_task_detail(v_comment.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------
create or replace function public.submit_task_evidence(
  p_task_id text,
  p_evidence_type text default 'photo',
  p_step_id uuid default null,
  p_storage_path text default null,
  p_external_url text default null,
  p_display_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_note_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_id uuid;
begin
  v_task := public.assert_operational_task_mutable(p_task_id);
  if not public.can_submit_task_evidence(v_task) then
    raise exception 'No tienes permiso para enviar evidencia.';
  end if;

  insert into public.task_evidence (
    task_id, step_id, evidence_type, storage_path, external_url,
    display_name, mime_type, size_bytes, note_text, submitted_by
  ) values (
    p_task_id,
    p_step_id,
    coalesce(nullif(trim(p_evidence_type), ''), 'photo'),
    nullif(trim(p_storage_path), ''),
    nullif(trim(p_external_url), ''),
    coalesce(nullif(trim(p_display_name), ''), 'Evidencia'),
    nullif(trim(p_mime_type), ''),
    p_size_bytes,
    nullif(trim(p_note_text), ''),
    auth.uid()
  ) returning id into v_id;

  perform public.log_task_activity(
    p_task_id, 'evidence_submitted', 'evidence',
    null, to_jsonb(coalesce(nullif(trim(p_display_name), ''), 'Evidencia')),
    jsonb_build_object('evidence_id', v_id, 'step_id', p_step_id)
  );

  return public.get_operational_task_detail(p_task_id);
end;
$$;

create or replace function public.verify_task_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev public.task_evidence;
begin
  select * into v_ev
  from public.task_evidence e
  where e.id = p_evidence_id and e.deleted_at is null
  for update;

  if not found then raise exception 'Evidencia no encontrada.'; end if;
  if not public.is_operational_task_area_manager() then
    raise exception 'Solo supervisores pueden verificar evidencia.';
  end if;

  update public.task_evidence
  set verified_by = auth.uid(), verified_at = now()
  where id = p_evidence_id;

  return public.get_operational_task_detail(v_ev.task_id);
end;
$$;

create or replace function public.delete_task_evidence(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev public.task_evidence;
begin
  select * into v_ev
  from public.task_evidence e
  where e.id = p_evidence_id and e.deleted_at is null
  for update;

  if not found then raise exception 'Evidencia no encontrada.'; end if;
  perform public.assert_operational_task_mutable(v_ev.task_id);

  update public.task_evidence
  set deleted_at = now(), deleted_by = auth.uid()
  where id = p_evidence_id;

  return public.get_operational_task_detail(v_ev.task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders (F5)
-- ---------------------------------------------------------------------------
create or replace function public.schedule_task_reminder(
  p_task_id text,
  p_reminder_at timestamptz,
  p_step_id uuid default null,
  p_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_profile uuid := coalesce(p_profile_id, auth.uid());
begin
  v_task := public.assert_operational_task_mutable(p_task_id);
  if p_reminder_at is null or p_reminder_at <= now() then
    raise exception 'La fecha del recordatorio debe ser futura.';
  end if;

  insert into public.task_reminder_deliveries (
    task_id, step_id, profile_id, reminder_at
  ) values (
    p_task_id, p_step_id, v_profile, p_reminder_at
  );

  return public.get_operational_task_detail(p_task_id);
end;
$$;

create or replace function public.process_pending_task_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select r.*
    from public.task_reminder_deliveries r
    where r.delivery_status = 'pending'
      and r.reminder_at <= now()
    order by r.reminder_at asc
    limit 200
  loop
    perform public.notify_operational_task_event(
      v_row.profile_id,
      'task_reminder',
      'Recordatorio de tarea',
      'Tienes un recordatorio pendiente.',
      v_row.task_id
    );
    update public.task_reminder_deliveries
    set delivery_status = 'sent', delivered_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurrence (F8 — disabled by default)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_task_recurrence(
  p_task_id text,
  p_frequency text default 'weekly',
  p_interval_days integer default null,
  p_next_run_at timestamptz default null,
  p_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
begin
  v_task := public.assert_operational_task_mutable(p_task_id);
  if not public.is_operational_task_area_manager() then
    raise exception 'Solo gerencia puede configurar recurrencia.';
  end if;

  insert into public.task_recurrence_rules (
    source_task_id, frequency, interval_days, next_run_at, enabled, created_by
  ) values (
    p_task_id,
    coalesce(nullif(trim(p_frequency), ''), 'weekly'),
    p_interval_days,
    p_next_run_at,
    coalesce(p_enabled, false),
    auth.uid()
  )
  on conflict (source_task_id) do update set
    frequency = excluded.frequency,
    interval_days = excluded.interval_days,
    next_run_at = excluded.next_run_at,
    enabled = excluded.enabled,
    updated_at = now();

  return public.get_operational_task_detail(p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.assert_operational_task_mutable(text) from public;
revoke all on function public.create_task_step_list(text, text, uuid) from public;
revoke all on function public.delete_task_step_list(uuid) from public;
revoke all on function public.create_task_step(uuid, text, numeric) from public;
revoke all on function public.update_task_step(uuid, jsonb) from public;
revoke all on function public.toggle_task_step(uuid, boolean) from public;
revoke all on function public.reorder_task_steps(uuid, uuid[]) from public;
revoke all on function public.move_task_step(uuid, uuid, numeric) from public;
revoke all on function public.delete_task_step(uuid) from public;
revoke all on function public.convert_task_step_to_task(uuid) from public;
revoke all on function public.register_task_attachment(text, uuid, text, text, text, bigint, text) from public;
revoke all on function public.delete_task_attachment(uuid) from public;
revoke all on function public.create_task_comment(text, text, uuid) from public;
revoke all on function public.delete_task_comment(uuid) from public;
revoke all on function public.submit_task_evidence(text, text, uuid, text, text, text, text, bigint, text) from public;
revoke all on function public.verify_task_evidence(uuid) from public;
revoke all on function public.delete_task_evidence(uuid) from public;
revoke all on function public.schedule_task_reminder(text, timestamptz, uuid, uuid) from public;
revoke all on function public.process_pending_task_reminders() from public;
revoke all on function public.upsert_task_recurrence(text, text, integer, timestamptz, boolean) from public;

grant execute on function public.create_task_step_list(text, text, uuid) to authenticated;
grant execute on function public.delete_task_step_list(uuid) to authenticated;
grant execute on function public.create_task_step(uuid, text, numeric) to authenticated;
grant execute on function public.update_task_step(uuid, jsonb) to authenticated;
grant execute on function public.toggle_task_step(uuid, boolean) to authenticated;
grant execute on function public.reorder_task_steps(uuid, uuid[]) to authenticated;
grant execute on function public.move_task_step(uuid, uuid, numeric) to authenticated;
grant execute on function public.delete_task_step(uuid) to authenticated;
grant execute on function public.convert_task_step_to_task(uuid) to authenticated;
grant execute on function public.register_task_attachment(text, uuid, text, text, text, bigint, text) to authenticated;
grant execute on function public.delete_task_attachment(uuid) to authenticated;
grant execute on function public.create_task_comment(text, text, uuid) to authenticated;
grant execute on function public.delete_task_comment(uuid) to authenticated;
grant execute on function public.submit_task_evidence(text, text, uuid, text, text, text, text, bigint, text) to authenticated;
grant execute on function public.verify_task_evidence(uuid) to authenticated;
grant execute on function public.delete_task_evidence(uuid) to authenticated;
grant execute on function public.schedule_task_reminder(text, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.upsert_task_recurrence(text, text, integer, timestamptz, boolean) to authenticated;

grant execute on function public.process_pending_task_reminders() to service_role;

grant execute on function public.get_operational_task_detail(text) to authenticated;
grant execute on function public.get_operational_tasks_board(text, uuid, text, boolean, integer, boolean) to authenticated;
grant execute on function public.update_operational_task(text, jsonb) to authenticated;
grant execute on function public.update_operational_task_status(text, text, text, text, text, text) to authenticated;
grant execute on function public.move_operational_task(text, text, numeric, text, text, text) to authenticated;
