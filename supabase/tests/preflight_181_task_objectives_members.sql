-- Preflight BEFORE applying 181 (objectives + members/watchers)
-- Run in Supabase SQL Editor. Expect notes below each block.

-- ---------------------------------------------------------------------------
-- A. Prerequisite: 180 must be applied
-- ---------------------------------------------------------------------------
select proname as required_rpc
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname = 'public'
  and proname in (
    'operational_task_card_summary',
    'get_operational_task_detail',
    'can_mutate_operational_task'
  )
order by proname;
-- Expect 3 rows. If fewer, apply 180 first.

-- ---------------------------------------------------------------------------
-- B. Already applied? (partial 181 detection)
-- ---------------------------------------------------------------------------
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assigned_tasks'
  and column_name in ('objective', 'expected_result');
-- 0 rows = not started. 2 rows = columns OK.

select to_regclass('public.task_watchers') as task_watchers_table;
-- null = not created yet.

select proname
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname = 'public'
  and proname = 'update_operational_task_members';
-- 0 rows = RPCs not applied yet.

-- ---------------------------------------------------------------------------
-- C. Active locks on assigned_tasks (run if you hit deadlock)
-- ---------------------------------------------------------------------------
select
  a.pid,
  a.usename,
  a.application_name,
  a.state,
  l.mode,
  c.relname
from pg_locks l
join pg_stat_activity a on a.pid = l.pid
left join pg_class c on c.oid = l.relation
where c.relname in ('assigned_tasks', 'task_assignees', 'task_watchers')
  and a.pid <> pg_backend_pid()
order by c.relname, a.pid;
-- If rows appear: close ERP tabs / stop dev server, wait 10s, retry.
