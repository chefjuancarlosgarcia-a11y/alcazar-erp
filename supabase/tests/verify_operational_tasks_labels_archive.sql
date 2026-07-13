-- Verify labels + archive migration 183 (after 183c).

select to_regclass('public.task_labels') as task_labels,
       to_regclass('public.task_label_assignments') as task_label_assignments;

select count(*)::int as seeded_labels
from public.task_labels
where scope = 'global' and deleted_at is null;

select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_task_labels_catalog',
    'update_operational_task_labels',
    'archive_operational_task',
    'restore_operational_task',
    'get_archived_operational_tasks',
    'task_labels_for_task',
    'can_administer_task_labels',
    'create_task_label',
    'update_task_label',
    'delete_task_label'
  )
order by proname;
