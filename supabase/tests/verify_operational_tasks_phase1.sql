-- Verification script for operational tasks phase 1 (schema 176-177).
-- Run in Supabase SQL editor as an authenticated admin/service role smoke test.

-- 1) Columns exist on assigned_tasks
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assigned_tasks'
  and column_name in (
    'task_source', 'description', 'area_id', 'waiting_reason',
    'created_by', 'deleted_at', 'legacy_local_id'
  )
order by column_name;

-- 2) Supporting tables
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('task_assignees', 'task_activity_log')
order by table_name;

-- 3) RPCs registered
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_operational_tasks_board',
    'get_my_operational_tasks',
    'get_operational_task_detail',
    'create_operational_task_quick',
    'create_operational_task',
    'update_operational_task_status'
  )
order by routine_name;

-- 4) Expediente rows tagged (read-only)
select
  count(*) filter (where task_source = 'employee_expediente') as expediente_tasks,
  count(*) filter (where task_source = 'operational') as operational_tasks
from public.assigned_tasks;

-- 5) Optional live test (uncomment with a valid active user session):
-- select public.create_operational_task_quick('Prueba verificación ERP tareas');
-- select public.get_my_operational_tasks();
-- select public.get_operational_tasks_board();
