-- 181a: schema only (run first). Apply after 180.

alter table public.assigned_tasks
  add column if not exists objective text not null default '',
  add column if not exists expected_result text not null default '';

update public.assigned_tasks
set objective = coalesce(nullif(trim(description), ''), objective)
where task_source = 'operational'
  and objective = ''
  and coalesce(trim(description), '') <> '';

-- ---------------------------------------------------------------------------
-- F1: Watchers (separate from assignees)
-- ---------------------------------------------------------------------------
create table if not exists public.task_watchers (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  notification_preferences jsonb not null default '{"reminders":true,"updates":true}'::jsonb,
  unique (task_id, profile_id)
);

create index if not exists task_watchers_task_idx on public.task_watchers (task_id);
create index if not exists task_watchers_profile_idx on public.task_watchers (profile_id);

alter table public.task_watchers enable row level security;

drop policy if exists task_watchers_select on public.task_watchers;
create policy task_watchers_select on public.task_watchers
  for select to authenticated
  using (
    exists (
      select 1
      from public.assigned_tasks t
      where t.id = task_watchers.task_id
        and t.task_source = 'operational'
        and public.can_access_operational_task(t, 'view')
    )
  );

revoke all on table public.task_watchers from public;
grant select on table public.task_watchers to authenticated;
