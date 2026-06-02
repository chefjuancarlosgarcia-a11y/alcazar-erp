-- Checklist notifications.
-- Apply after 029_task_checklists.sql.

alter table public.notifications
  add column if not exists action_url text,
  add column if not exists created_by uuid references public.profiles(id);

create unique index if not exists notifications_checklist_user_unique
  on public.notifications (user_id, type, entity_type, entity_id)
  where user_id is not null
    and type = 'checklist'
    and entity_type = 'checklist_run';

create or replace function public.create_checklist_run_notifications(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_profile_role();
  run_record public.checklist_runs;
  template_title text;
  inserted_count integer := 0;
begin
  if public.normalize_profile_role(actor_role) not in ('admin', 'gerente_general', 'gerente', 'supervisor') then
    raise exception 'No tienes permiso para generar notificaciones de checklist.';
  end if;

  select * into run_record
  from public.checklist_runs
  where id = p_run_id;

  if run_record.id is null then
    raise exception 'Checklist no encontrada.';
  end if;

  select title into template_title
  from public.checklist_templates
  where id = run_record.template_id;

  with recipients as (
    select distinct p.id
    from public.profiles p
    where p.status = 'active'
      and (
        (run_record.assigned_profile_id is not null and p.id = run_record.assigned_profile_id)
        or (
          run_record.assigned_profile_id is null
          and nullif(trim(coalesce(run_record.assigned_role, '')), '') is not null
          and public.normalize_profile_role(p.role) = public.normalize_profile_role(run_record.assigned_role)
        )
        or (
          run_record.assigned_profile_id is null
          and nullif(trim(coalesce(run_record.assigned_role, '')), '') is null
          and nullif(trim(coalesce(run_record.area, '')), '') is not null
          and (
            nullif(trim(coalesce(p.area_name, '')), '') = nullif(trim(coalesce(run_record.area, '')), '')
            or nullif(trim(coalesce(p.area_id, '')), '') = nullif(trim(coalesce(run_record.area, '')), '')
          )
        )
      )
  ),
  inserted as (
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    select
      recipients.id,
      null,
      'checklist',
      'Checklist asignada',
      'Se te asigno la checklist: ' || coalesce(template_title, 'Checklist'),
      'checklist_run',
      run_record.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_record.id::text,
      auth.uid()
    from recipients
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = recipients.id
        and n.type = 'checklist'
        and n.entity_type = 'checklist_run'
        and n.entity_id = run_record.id::text
    )
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;

create or replace function public.mark_checklist_notifications_read(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications
  set is_read = true
  where type = 'checklist'
    and entity_type = 'checklist_run'
    and entity_id = p_run_id::text
    and user_id = auth.uid();
end;
$$;

revoke all on function public.create_checklist_run_notifications(uuid), public.mark_checklist_notifications_read(uuid) from public;
grant execute on function public.create_checklist_run_notifications(uuid), public.mark_checklist_notifications_read(uuid) to authenticated;
