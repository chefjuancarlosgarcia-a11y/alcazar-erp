-- Phase B verification (post-apply)
-- Run in Supabase SQL Editor after 180_task_card_board.sql

-- 1. sort_position column exists
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assigned_tasks'
  and column_name = 'sort_position';

-- 2. waiting_reason includes date
select conname, pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where conrelid = 'public.assigned_tasks'::regclass
  and conname = 'assigned_tasks_waiting_reason_check';

-- 3. unique active assignee index
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'task_assignees_active_profile_uidx';

-- 4. operational sort index
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'assigned_tasks_operational_sort_idx';

-- 5. RPCs exist
select proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'operational_task_card_summary',
    'move_operational_task',
    'get_operational_task_permissions',
    'can_mutate_operational_task',
    'get_operational_tasks_board',
    'get_operational_task_detail',
    'get_my_operational_tasks',
    'update_operational_task_status'
  )
order by proname;

-- 6. Grants on new RPCs (authenticated should have EXECUTE)
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'move_operational_task',
    'operational_task_card_summary',
    'can_mutate_operational_task',
    'get_operational_task_permissions'
  )
  and grantee = 'authenticated'
order by routine_name;

-- 7. Backfill sanity: operational tasks should not have sort_position = 0 unless brand new
select count(*) as operational_with_zero_sort
from public.assigned_tasks
where task_source = 'operational'
  and deleted_at is null
  and sort_position = 0;

-- 8. employee_expediente untouched by operational board filter (informational)
select count(*) as expediente_count
from public.assigned_tasks
where task_source = 'employee_expediente';

-- 9. Manual smoke (run authenticated via PostgREST/RPC in app):
-- select public.get_operational_tasks_board(null, null, null, false, 7, false);
