-- F0 + F1 verification (post-apply)
-- Run in Supabase SQL Editor after 181_task_objectives_members.sql

-- 1. objective + expected_result columns
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assigned_tasks'
  and column_name in ('objective', 'expected_result');

-- 2. task_watchers table
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'task_watchers'
order by ordinal_position;

-- 3. permissions extended
select public.get_operational_task_permissions(t.*)
from public.assigned_tasks t
where t.task_source = 'operational'
limit 1;

-- 4. RPCs exist
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'update_operational_task_members',
    'notify_operational_task_event',
    'ensure_operational_task_assignee_watchers'
  )
order by proname;

-- 5. employee_expediente untouched
select count(*) as expediente_tasks
from public.assigned_tasks
where task_source = 'employee_expediente';
