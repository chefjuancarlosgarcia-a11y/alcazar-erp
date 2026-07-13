-- Verify work center migration 182 (run after 182a–182d).

-- 1. Schema columns
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'assigned_tasks'
  and column_name in ('waiting_unblock_note', 'waiting_since', 'planned_start_at');

-- 2. blocked status allowed
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.assigned_tasks'::regclass
  and conname = 'assigned_tasks_status_check';

-- 3. Work plan tables
select to_regclass('public.task_step_lists') as step_lists,
       to_regclass('public.task_steps') as steps,
       to_regclass('public.task_attachments') as attachments,
       to_regclass('public.task_comments') as comments,
       to_regclass('public.task_evidence') as evidence,
       to_regclass('public.task_reminder_deliveries') as reminders,
       to_regclass('public.task_recurrence_rules') as recurrence;

-- 4. Storage bucket
select id, public, file_size_limit
from storage.buckets
where id = 'task-files';

-- 5. RPCs
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'create_task_step_list',
    'toggle_task_step',
    'register_task_attachment',
    'create_task_comment',
    'submit_task_evidence',
    'get_task_next_work_step',
    'task_work_plan_json'
  )
order by proname;

-- 6. Permissions extension
select public.get_operational_task_permissions(t)
from public.assigned_tasks t
where t.task_source = 'operational'
limit 1;
