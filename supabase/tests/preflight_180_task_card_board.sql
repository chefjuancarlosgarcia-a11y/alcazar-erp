-- Preflight checks BEFORE applying 180_task_card_board.sql
-- Run in Supabase SQL Editor as postgres / service role.
-- All queries must return zero blocking rows before applying the migration.

-- ---------------------------------------------------------------------------
-- A. Prerequisites: migrations 176–179 must already be applied
-- ---------------------------------------------------------------------------
select proname as required_rpc
from pg_proc
join pg_namespace n on n.oid = pg_proc.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_operational_tasks_board',
    'update_operational_task',
    'update_operational_task_assignees',
    'can_access_operational_task'
  )
order by proname;
-- Expect 4 rows. If fewer, stop and apply 176–179 first.

-- ---------------------------------------------------------------------------
-- B. waiting_reason values that would violate the new CHECK constraint
-- ---------------------------------------------------------------------------
select id, task_source, status, waiting_reason
from public.assigned_tasks
where waiting_reason is not null
  and waiting_reason not in (
    'vendor', 'approval', 'info', 'collaborator', 'spare_part', 'date', 'other'
  );
-- Expect 0 rows. If any, normalize before applying 180.

-- ---------------------------------------------------------------------------
-- C. Duplicate active assignees (would block unique index creation)
-- ---------------------------------------------------------------------------
select task_id, profile_id, count(*) as active_rows
from public.task_assignees
where status = 'active'
group by task_id, profile_id
having count(*) > 1;
-- Expect 0 rows. If any, deduplicate before applying 180.

-- ---------------------------------------------------------------------------
-- D. employee_expediente sanity (must not be touched by board RPCs)
-- ---------------------------------------------------------------------------
select count(*) as expediente_tasks
from public.assigned_tasks
where task_source = 'employee_expediente';
-- Informational only. Board RPCs filter task_source = 'operational'.

-- ---------------------------------------------------------------------------
-- E. Operational tasks without sort_position column yet (informational)
-- ---------------------------------------------------------------------------
select count(*) as operational_tasks
from public.assigned_tasks
where task_source = 'operational'
  and deleted_at is null;

-- ---------------------------------------------------------------------------
-- F. Existing index names (idempotency check)
-- ---------------------------------------------------------------------------
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'assigned_tasks_operational_sort_idx',
    'task_assignees_active_profile_uidx'
  );
