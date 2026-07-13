-- Post-apply diagnostics for sort_position (Phase B)
-- Run after 180_task_card_board.sql and functional testing.

-- 1. Null sort_position on operational tasks (should be 0 rows)
select id, title, status, sort_position
from public.assigned_tasks
where task_source = 'operational'
  and deleted_at is null
  and archived_at is null
  and sort_position is null;

-- 2. Duplicate sort_position within same status (informational; fractional model allows ties)
select status, sort_position, count(*) as task_count
from public.assigned_tasks
where task_source = 'operational'
  and deleted_at is null
  and archived_at is null
  and status not in ('completed', 'cancelled')
group by status, sort_position
having count(*) > 1
order by task_count desc, status
limit 50;

-- 3. Extremely small fractional gaps (reindex candidate threshold: gap < 0.001)
with ordered as (
  select
    id,
    status,
    sort_position,
    lag(sort_position) over (partition by status order by sort_position) as prev_pos
  from public.assigned_tasks
  where task_source = 'operational'
    and deleted_at is null
    and archived_at is null
    and status not in ('completed', 'cancelled')
)
select id, status, sort_position, prev_pos, (sort_position - prev_pos) as gap
from ordered
where prev_pos is not null
  and (sort_position - prev_pos) > 0
  and (sort_position - prev_pos) < 0.001
order by gap asc
limit 50;
-- If many rows appear after heavy reordering, plan future normalize_operational_task_sort_positions().

-- 4. Extremely large sort_position values
select id, title, status, sort_position
from public.assigned_tasks
where task_source = 'operational'
  and sort_position > extract(epoch from now()) * 10000
order by sort_position desc
limit 20;

-- 5. Tasks that might disappear from board (completed filter: last 7 days)
select id, title, status, completed_at, updated_at
from public.assigned_tasks
where task_source = 'operational'
  and status = 'completed'
  and deleted_at is null
  and archived_at is null
  and coalesce(completed_at, updated_at) < now() - interval '7 days'
order by coalesce(completed_at, updated_at) desc
limit 20;
-- These are hidden unless p_include_old_completed = true.

-- 6. waiting_reason left on non-waiting tasks (data inconsistency)
select id, title, status, waiting_reason
from public.assigned_tasks
where task_source = 'operational'
  and status <> 'waiting'
  and waiting_reason is not null;

-- 7. Activity noise from reorder (informational)
select action, count(*) as events
from public.task_activity_log
where action in ('moved', 'status_changed', 'updated', 'assignees_updated', 'created')
  and created_at >= now() - interval '7 days'
group by action
order by events desc;
