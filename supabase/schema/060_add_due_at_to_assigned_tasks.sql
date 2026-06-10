-- Assigned operational tasks with due_at for future Supabase sync.
-- Apply after 059_attendance_authorized_devices.sql.
-- Note: frontend currently persists tasks in localStorage; due_at is stored on each task payload.

create table if not exists public.assigned_tasks (
  id text primary key,
  template_id text,
  title text not null default '',
  status text not null default 'pending',
  execution_date date,
  scheduled_start time,
  due_date date,
  due_at timestamptz,
  assigned_profile_ids uuid[] not null default '{}',
  assigned_by uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assigned_tasks_due_at_idx
  on public.assigned_tasks (due_at)
  where status not in ('completed', 'cancelled');

alter table public.assigned_tasks enable row level security;

grant select, insert, update, delete on public.assigned_tasks to authenticated;
grant all on public.assigned_tasks to service_role;

create or replace function public.is_assigned_task_manager()
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
        'admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos'
      )
  );
$$;

revoke all on function public.is_assigned_task_manager() from public;
grant execute on function public.is_assigned_task_manager() to authenticated;

drop policy if exists "assigned_tasks_manager_all" on public.assigned_tasks;
create policy "assigned_tasks_manager_all"
  on public.assigned_tasks
  for all
  to authenticated
  using (public.is_assigned_task_manager())
  with check (public.is_assigned_task_manager());

drop policy if exists "assigned_tasks_assignee_read" on public.assigned_tasks;
create policy "assigned_tasks_assignee_read"
  on public.assigned_tasks
  for select
  to authenticated
  using (auth.uid() = any(assigned_profile_ids));
