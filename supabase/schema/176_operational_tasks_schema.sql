-- Operational tasks v2: extend assigned_tasks, assignees, activity log.
-- Apply after 175_rls_active_profile_guard.sql.
-- Preserves employee_expediente rows (task_source = employee_expediente).

-- ---------------------------------------------------------------------------
-- Extend assigned_tasks
-- ---------------------------------------------------------------------------
alter table public.assigned_tasks
  add column if not exists task_source text not null default 'operational',
  add column if not exists description text not null default '',
  add column if not exists area_id text references public.areas(id) on delete set null,
  add column if not exists category text,
  add column if not exists priority text not null default 'medium',
  add column if not exists difficulty text,
  add column if not exists waiting_reason text,
  add column if not exists next_action text,
  add column if not exists simple_steps jsonb not null default '[]'::jsonb,
  add column if not exists evidence_required boolean not null default false,
  add column if not exists completion_notes text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_activity_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text,
  add column if not exists legacy_local_id text,
  add column if not exists project_id uuid;

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_task_source_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_task_source_check
  check (task_source in ('operational', 'employee_expediente'));

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_status_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_status_check
  check (status in (
    'pending', 'in_progress', 'waiting', 'in_review',
    'completed', 'cancelled', 'review_required'
  ));

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_priority_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_priority_check
  check (priority in ('low', 'medium', 'high', 'critical'));

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_waiting_reason_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_waiting_reason_check
  check (
    waiting_reason is null
    or waiting_reason in ('vendor', 'approval', 'info', 'collaborator', 'spare_part', 'other')
  );

create unique index if not exists assigned_tasks_legacy_local_id_uidx
  on public.assigned_tasks (legacy_local_id)
  where legacy_local_id is not null;

create index if not exists assigned_tasks_operational_board_idx
  on public.assigned_tasks (task_source, status, due_at)
  where task_source = 'operational'
    and deleted_at is null
    and archived_at is null;

create index if not exists assigned_tasks_operational_area_idx
  on public.assigned_tasks (area_id, status)
  where task_source = 'operational'
    and deleted_at is null;

create index if not exists assigned_tasks_created_by_idx
  on public.assigned_tasks (created_by, created_at desc)
  where task_source = 'operational';

-- Backfill HR / expediente rows
update public.assigned_tasks
set task_source = 'employee_expediente'
where task_source = 'operational'
  and (
    coalesce(payload ->> 'source', '') = 'employee_expediente'
    or id like 'expediente-%'
  );

create or replace function public.trg_assigned_tasks_infer_task_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_source = 'operational'
    and (
      coalesce(new.payload ->> 'source', '') = 'employee_expediente'
      or new.id like 'expediente-%'
    ) then
    new.task_source := 'employee_expediente';
  end if;
  return new;
end;
$$;

drop trigger if exists assigned_tasks_infer_task_source_trg on public.assigned_tasks;
create trigger assigned_tasks_infer_task_source_trg
  before insert or update on public.assigned_tasks
  for each row execute function public.trg_assigned_tasks_infer_task_source();

-- ---------------------------------------------------------------------------
-- task_assignees
-- ---------------------------------------------------------------------------
create table if not exists public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assignment_role text not null default 'primary'
    check (assignment_role in ('primary', 'participant')),
  status text not null default 'active'
    check (status in ('active', 'transferred', 'completed')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  unassigned_at timestamptz,
  unassigned_by uuid references public.profiles(id) on delete set null,
  unassign_reason text
);

create unique index if not exists task_assignees_active_primary_uidx
  on public.task_assignees (task_id)
  where assignment_role = 'primary' and status = 'active';

create index if not exists task_assignees_profile_active_idx
  on public.task_assignees (profile_id, status)
  where status = 'active';

create index if not exists task_assignees_task_idx
  on public.task_assignees (task_id, assigned_at desc);

alter table public.task_assignees enable row level security;

grant select on public.task_assignees to authenticated;
grant all on public.task_assignees to service_role;

-- ---------------------------------------------------------------------------
-- task_activity_log
-- ---------------------------------------------------------------------------
create table if not exists public.task_activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_log_task_idx
  on public.task_activity_log (task_id, created_at desc);

alter table public.task_activity_log enable row level security;

grant select on public.task_activity_log to authenticated;
grant all on public.task_activity_log to service_role;

-- ---------------------------------------------------------------------------
-- Sync assigned_profile_ids from task_assignees
-- ---------------------------------------------------------------------------
create or replace function public.sync_assigned_tasks_profile_ids(p_task_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.assigned_tasks t
  set
    assigned_profile_ids = coalesce((
      select array_agg(distinct ta.profile_id order by ta.profile_id)
      from public.task_assignees ta
      where ta.task_id = p_task_id
        and ta.status = 'active'
    ), '{}'::uuid[]),
    updated_at = now()
  where t.id = p_task_id;
$$;

create or replace function public.trg_task_assignees_sync_profile_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_assigned_tasks_profile_ids(coalesce(new.task_id, old.task_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists task_assignees_sync_profile_ids_trg on public.task_assignees;
create trigger task_assignees_sync_profile_ids_trg
  after insert or update or delete on public.task_assignees
  for each row execute function public.trg_task_assignees_sync_profile_ids();

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_operational_task_executive_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'ceo', 'gerente_general', 'gerente'
      )
  );
$$;

create or replace function public.is_operational_task_area_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos', 'encargado_area'
      )
  );
$$;

create or replace function public.can_assign_profile_to_operational_task(
  p_assignee_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
  target_role text;
  target_supervisor uuid;
begin
  if auth.uid() is null or p_assignee_id is null then
    return false;
  end if;

  if not public.is_current_profile_active() then
    return false;
  end if;

  select
    public.normalize_profile_role(p.role),
    p.supervisor_profile_id
  into target_role, target_supervisor
  from public.profiles p
  where p.id = p_assignee_id
    and p.status = 'active';

  if target_role is null then
    return false;
  end if;

  if actor_role in ('admin', 'gerente_general', 'gerente') then
    return true;
  end if;

  if actor_role = 'recursos_humanos' then
    return target_role not in ('admin', 'gerente_general');
  end if;

  if actor_role = 'supervisor' then
    return target_supervisor = auth.uid()
      and target_role not in ('admin', 'gerente_general', 'gerente', 'recursos_humanos', 'supervisor');
  end if;

  if actor_role = 'encargado_area' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.can_access_operational_task(
  p_task public.assigned_tasks,
  p_intent text default 'view'
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
  actor_area text;
  task_area text;
begin
  if auth.uid() is null or p_task.id is null then
    return false;
  end if;

  if not public.is_current_profile_active() then
    return false;
  end if;

  if p_task.task_source = 'employee_expediente' then
    return auth.uid() = any (p_task.assigned_profile_ids)
      or public.is_assigned_task_manager();
  end if;

  if p_task.deleted_at is not null and actor_role <> 'admin' then
    return false;
  end if;

  if exists (
    select 1
    from public.task_assignees ta
    where ta.task_id = p_task.id
      and ta.profile_id = auth.uid()
      and ta.status = 'active'
  ) then
    return true;
  end if;

  if p_task.created_by = auth.uid() then
    return true;
  end if;

  if public.is_operational_task_executive_reader() then
    return true;
  end if;

  if public.is_assigned_task_manager() then
    if actor_role = 'supervisor' then
      return exists (
        select 1
        from public.task_assignees ta
        join public.profiles p on p.id = ta.profile_id
        where ta.task_id = p_task.id
          and ta.status = 'active'
          and p.supervisor_profile_id = auth.uid()
      ) or p_task.created_by = auth.uid();
    end if;

    if actor_role in ('recursos_humanos', 'encargado_area') then
      select coalesce(p.area_id, '') into actor_area
      from public.profiles p
      where p.id = auth.uid();
      task_area := coalesce(p_task.area_id, '');
      if actor_role = 'recursos_humanos' then
        return task_area = 'administracion'
          or coalesce(p_task.category, '') in ('Recursos Humanos', 'Capacitación');
      end if;
      return actor_area = '' or task_area = '' or actor_area = task_area;
    end if;

    return true;
  end if;

  return false;
end;
$$;

create or replace function public.log_task_activity(
  p_task_id text,
  p_action text,
  p_field_name text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.task_activity_log (
    task_id, actor_id, action, field_name, old_value, new_value, metadata
  )
  values (
    p_task_id, auth.uid(), p_action, p_field_name, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  update public.assigned_tasks
  set last_activity_at = now(), updated_at = now()
  where id = p_task_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy if exists "assigned_tasks_manager_all" on public.assigned_tasks;
drop policy if exists "assigned_tasks_assignee_read" on public.assigned_tasks;

create policy "assigned_tasks_operational_select"
  on public.assigned_tasks
  for select
  to authenticated
  using (public.can_access_operational_task(assigned_tasks, 'view'));

create policy "assigned_tasks_expediente_manager_write"
  on public.assigned_tasks
  for all
  to authenticated
  using (
    task_source = 'employee_expediente'
    and public.is_assigned_task_manager()
  )
  with check (
    task_source = 'employee_expediente'
    and public.is_assigned_task_manager()
  );

drop policy if exists "task_assignees_select" on public.task_assignees;
create policy "task_assignees_select"
  on public.task_assignees
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.assigned_tasks t
      where t.id = task_assignees.task_id
        and public.can_access_operational_task(t, 'view')
    )
  );

drop policy if exists "task_activity_log_select" on public.task_activity_log;
create policy "task_activity_log_select"
  on public.task_activity_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.assigned_tasks t
      where t.id = task_activity_log.task_id
        and public.can_access_operational_task(t, 'view')
    )
  );

revoke insert, update, delete on public.assigned_tasks from authenticated;
grant select on public.assigned_tasks to authenticated;

revoke all on function public.sync_assigned_tasks_profile_ids(text) from public;
revoke all on function public.is_operational_task_executive_reader() from public;
revoke all on function public.is_operational_task_area_manager() from public;
revoke all on function public.can_assign_profile_to_operational_task(uuid) from public;
revoke all on function public.can_access_operational_task(public.assigned_tasks, text) from public;
revoke all on function public.log_task_activity(text, text, text, jsonb, jsonb, jsonb) from public;

grant execute on function public.sync_assigned_tasks_profile_ids(text) to service_role;
grant execute on function public.is_operational_task_executive_reader() to authenticated;
grant execute on function public.is_operational_task_area_manager() to authenticated;
grant execute on function public.can_assign_profile_to_operational_task(uuid) to authenticated;
grant execute on function public.can_access_operational_task(public.assigned_tasks, text) to authenticated;
grant execute on function public.log_task_activity(text, text, text, jsonb, jsonb, jsonb) to authenticated;
