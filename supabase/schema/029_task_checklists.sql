-- Operational checklists for Tasks.
-- Apply after 028_hr_schedule_asueto.sql.

create extension if not exists pgcrypto;

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  area text,
  assigned_role text,
  assigned_profile_id uuid references public.profiles(id),
  frequency text not null default 'manual'
    check (frequency in ('manual', 'diaria', 'semanal', 'mensual', 'apertura', 'cierre', 'por_turno')),
  shift_context text not null default 'general'
    check (shift_context in ('general', 'apertura', 'servicio', 'cierre', 'limpieza_profunda', 'inventario')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  item_order integer not null default 0,
  title text not null,
  description text,
  response_type text not null default 'checkbox'
    check (response_type in ('checkbox', 'text', 'number', 'photo', 'temperature', 'signature', 'select')),
  is_required boolean not null default true,
  requires_photo boolean not null default false,
  requires_comment boolean not null default false,
  score_points integer not null default 1 check (score_points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.checklist_templates(id),
  run_date date not null default current_date,
  area text,
  assigned_profile_id uuid references public.profiles(id),
  assigned_role text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'overdue', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  total_points integer not null default 0,
  earned_points integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.checklist_runs(id) on delete cascade,
  template_item_id uuid references public.checklist_template_items(id),
  item_order integer not null default 0,
  title text not null,
  response_type text not null default 'checkbox'
    check (response_type in ('checkbox', 'text', 'number', 'photo', 'temperature', 'signature', 'select')),
  is_required boolean not null default true,
  requires_photo boolean not null default false,
  requires_comment boolean not null default false,
  checked boolean not null default false,
  response_text text,
  response_number numeric,
  photo_url text,
  comment text,
  score_points integer not null default 1 check (score_points >= 0),
  earned_points integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists checklist_templates_status_idx on public.checklist_templates(status);
create index if not exists checklist_templates_area_idx on public.checklist_templates(area);
create index if not exists checklist_template_items_template_idx on public.checklist_template_items(template_id, item_order);
create index if not exists checklist_runs_date_status_idx on public.checklist_runs(run_date, status);
create index if not exists checklist_runs_assignment_idx on public.checklist_runs(assigned_profile_id, assigned_role, area);
create index if not exists checklist_run_items_run_idx on public.checklist_run_items(run_id, item_order);

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_runs enable row level security;
alter table public.checklist_run_items enable row level security;

grant select, insert, update on
  public.checklist_templates,
  public.checklist_runs,
  public.checklist_run_items
to authenticated;

grant select, insert, update, delete on public.checklist_template_items to authenticated;

grant all on
  public.checklist_templates,
  public.checklist_template_items,
  public.checklist_runs,
  public.checklist_run_items
to service_role;

create or replace function public.is_checklist_template_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'supervisor')
  );
$$;

create or replace function public.can_access_checklists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor', 'encargado_almacen',
        'recursos_humanos', 'cocina', 'pizzeria', 'barista', 'bartender',
        'panadero', 'repostero', 'caja', 'mesero', 'limpieza', 'mantenimiento',
        'colaborador'
      )
  );
$$;

create or replace function public.can_access_checklist_run(p_run public.checklist_runs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and (
        public.normalize_profile_role(role) in ('admin', 'gerente_general', 'gerente', 'supervisor')
        or p_run.assigned_profile_id = auth.uid()
        or public.normalize_profile_role(role) = public.normalize_profile_role(p_run.assigned_role)
        or nullif(trim(coalesce(p_run.area, '')), '') = nullif(trim(coalesce(area_name, '')), '')
      )
  );
$$;

create or replace function public.set_checklist_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.recalculate_checklist_run_points(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.checklist_runs run
  set
    total_points = coalesce(points.total_points, 0),
    earned_points = coalesce(points.earned_points, 0),
    updated_at = now()
  from (
    select
      run_id,
      sum(score_points)::integer as total_points,
      sum(earned_points)::integer as earned_points
    from public.checklist_run_items
    where run_id = p_run_id
    group by run_id
  ) points
  where run.id = p_run_id;
end;
$$;

create or replace function public.set_checklist_run_item_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.checked
    or nullif(trim(coalesce(new.response_text, '')), '') is not null
    or new.response_number is not null
    or nullif(trim(coalesce(new.photo_url, '')), '') is not null
  then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
    new.earned_points := new.score_points;
  else
    new.completed_at := null;
    new.completed_by := null;
    new.earned_points := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists set_checklist_templates_updated_at on public.checklist_templates;
create trigger set_checklist_templates_updated_at
  before update on public.checklist_templates
  for each row execute procedure public.set_checklist_updated_at();

drop trigger if exists set_checklist_runs_updated_at on public.checklist_runs;
create trigger set_checklist_runs_updated_at
  before update on public.checklist_runs
  for each row execute procedure public.set_checklist_updated_at();

drop trigger if exists set_checklist_run_item_completion on public.checklist_run_items;
create trigger set_checklist_run_item_completion
  before insert or update on public.checklist_run_items
  for each row execute procedure public.set_checklist_run_item_completion();

drop policy if exists "checklist_templates_authorized_read" on public.checklist_templates;
create policy "checklist_templates_authorized_read"
  on public.checklist_templates for select to authenticated
  using (public.can_access_checklists());

drop policy if exists "checklist_templates_managers_insert" on public.checklist_templates;
create policy "checklist_templates_managers_insert"
  on public.checklist_templates for insert to authenticated
  with check (public.is_checklist_template_manager());

drop policy if exists "checklist_templates_managers_update" on public.checklist_templates;
create policy "checklist_templates_managers_update"
  on public.checklist_templates for update to authenticated
  using (public.is_checklist_template_manager())
  with check (public.is_checklist_template_manager());

drop policy if exists "checklist_template_items_authorized_read" on public.checklist_template_items;
create policy "checklist_template_items_authorized_read"
  on public.checklist_template_items for select to authenticated
  using (public.can_access_checklists());

drop policy if exists "checklist_template_items_managers_insert" on public.checklist_template_items;
create policy "checklist_template_items_managers_insert"
  on public.checklist_template_items for insert to authenticated
  with check (public.is_checklist_template_manager());

drop policy if exists "checklist_template_items_managers_update" on public.checklist_template_items;
create policy "checklist_template_items_managers_update"
  on public.checklist_template_items for update to authenticated
  using (public.is_checklist_template_manager())
  with check (public.is_checklist_template_manager());

drop policy if exists "checklist_template_items_managers_delete" on public.checklist_template_items;
create policy "checklist_template_items_managers_delete"
  on public.checklist_template_items for delete to authenticated
  using (public.is_checklist_template_manager());

drop policy if exists "checklist_runs_authorized_read" on public.checklist_runs;
create policy "checklist_runs_authorized_read"
  on public.checklist_runs for select to authenticated
  using (public.can_access_checklist_run(checklist_runs));

drop policy if exists "checklist_runs_managers_insert" on public.checklist_runs;
create policy "checklist_runs_managers_insert"
  on public.checklist_runs for insert to authenticated
  with check (public.can_access_checklists());

drop policy if exists "checklist_runs_authorized_update" on public.checklist_runs;
create policy "checklist_runs_authorized_update"
  on public.checklist_runs for update to authenticated
  using (public.can_access_checklist_run(checklist_runs))
  with check (public.can_access_checklist_run(checklist_runs));

drop policy if exists "checklist_run_items_authorized_read" on public.checklist_run_items;
create policy "checklist_run_items_authorized_read"
  on public.checklist_run_items for select to authenticated
  using (
    exists (
      select 1 from public.checklist_runs run
      where run.id = checklist_run_items.run_id
        and public.can_access_checklist_run(run)
    )
  );

drop policy if exists "checklist_run_items_authorized_insert" on public.checklist_run_items;
create policy "checklist_run_items_authorized_insert"
  on public.checklist_run_items for insert to authenticated
  with check (
    exists (
      select 1 from public.checklist_runs run
      where run.id = checklist_run_items.run_id
        and public.can_access_checklist_run(run)
    )
  );

drop policy if exists "checklist_run_items_authorized_update" on public.checklist_run_items;
create policy "checklist_run_items_authorized_update"
  on public.checklist_run_items for update to authenticated
  using (
    exists (
      select 1 from public.checklist_runs run
      where run.id = checklist_run_items.run_id
        and public.can_access_checklist_run(run)
    )
  )
  with check (
    exists (
      select 1 from public.checklist_runs run
      where run.id = checklist_run_items.run_id
        and public.can_access_checklist_run(run)
    )
  );

revoke all on function
  public.is_checklist_template_manager(),
  public.can_access_checklists(),
  public.can_access_checklist_run(public.checklist_runs),
  public.recalculate_checklist_run_points(uuid)
from public;

grant execute on function
  public.is_checklist_template_manager(),
  public.can_access_checklists(),
  public.can_access_checklist_run(public.checklist_runs),
  public.recalculate_checklist_run_points(uuid)
to authenticated;
