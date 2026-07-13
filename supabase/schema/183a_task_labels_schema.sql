-- 183a: Task labels + archive columns — apply after 182e.

alter table public.assigned_tasks
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Label catalog
-- ---------------------------------------------------------------------------
create table if not exists public.task_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color_key text not null default 'teal'
    check (color_key in ('teal', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'slate')),
  description text,
  scope text not null default 'global'
    check (scope in ('global', 'area')),
  area_id text references public.areas(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create unique index if not exists task_labels_name_scope_uidx
  on public.task_labels (lower(name), scope, coalesce(area_id, ''))
  where deleted_at is null;

create index if not exists task_labels_scope_idx
  on public.task_labels (scope, area_id)
  where deleted_at is null and archived_at is null;

-- ---------------------------------------------------------------------------
-- Task ↔ label assignments
-- ---------------------------------------------------------------------------
create table if not exists public.task_label_assignments (
  task_id text not null references public.assigned_tasks(id) on delete cascade,
  label_id uuid not null references public.task_labels(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (task_id, label_id)
);

create index if not exists task_label_assignments_label_idx
  on public.task_label_assignments (label_id);

create index if not exists task_label_assignments_task_idx
  on public.task_label_assignments (task_id);

alter table public.task_labels enable row level security;
alter table public.task_label_assignments enable row level security;

revoke all on table public.task_labels from public;
revoke all on table public.task_label_assignments from public;
grant select on table public.task_labels to authenticated;
grant select on table public.task_label_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Seed global labels
-- ---------------------------------------------------------------------------
insert into public.task_labels (name, color_key, scope)
select v.name, v.color_key, 'global'
from (values
  ('Cocina', 'orange'),
  ('Almacén', 'blue'),
  ('Marketing', 'pink'),
  ('Contabilidad', 'slate'),
  ('Servicio', 'green'),
  ('Limpieza', 'teal'),
  ('Cafetería', 'yellow'),
  ('Mantenimiento', 'red'),
  ('Proveedor', 'purple'),
  ('Capacitación', 'blue'),
  ('Urgente', 'red')
) as v(name, color_key)
where not exists (
  select 1 from public.task_labels tl
  where tl.scope = 'global'
    and lower(tl.name) = lower(v.name)
    and tl.deleted_at is null
);
