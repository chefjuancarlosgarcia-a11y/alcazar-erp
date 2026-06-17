-- Printing foundation: ERP -> print_jobs -> local print-agent -> Windows printers.
-- Apply after 094_checklist_run_logical_dedupe.sql.

create table if not exists public.pos_printers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  windows_printer_name text not null,
  location text,
  printer_type text not null default 'windows_usb'
    check (printer_type in ('windows_usb', 'windows_network', 'tcp_ip')),
  ip_address text,
  port integer not null default 9100,
  paper_width text not null default '80mm'
    check (paper_width in ('58mm', '80mm')),
  supported_job_types text[] not null default array['test']::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  printer_id uuid not null references public.pos_printers(id),
  job_type text not null
    check (job_type in ('prebill', 'receipt', 'delivery_order', 'test')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'printed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  error_message text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

create table if not exists public.print_job_logs (
  id uuid primary key default gen_random_uuid(),
  print_job_id uuid not null references public.print_jobs(id) on delete cascade,
  status text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists pos_printers_active_location_idx
  on public.pos_printers(is_active, location);

create index if not exists print_jobs_pending_idx
  on public.print_jobs(status, created_at)
  where status in ('pending', 'printing');

create index if not exists print_jobs_printer_idx
  on public.print_jobs(printer_id, created_at desc);

alter table public.pos_printers enable row level security;
alter table public.print_jobs enable row level security;
alter table public.print_job_logs enable row level security;

grant select, insert, update on public.pos_printers to authenticated;
grant select, insert on public.print_jobs to authenticated;
grant select on public.print_job_logs to authenticated;
grant all on public.pos_printers, public.print_jobs, public.print_job_logs to service_role;

create or replace function public.can_manage_printing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.normalize_profile_role(public.current_profile_role()), '') in ('admin', 'gerente_general');
$$;

drop policy if exists "pos_printers_admin_read" on public.pos_printers;
create policy "pos_printers_admin_read"
  on public.pos_printers for select to authenticated
  using (public.can_manage_printing());

drop policy if exists "pos_printers_admin_write" on public.pos_printers;
create policy "pos_printers_admin_write"
  on public.pos_printers for all to authenticated
  using (public.can_manage_printing())
  with check (public.can_manage_printing());

drop policy if exists "print_jobs_admin_read" on public.print_jobs;
create policy "print_jobs_admin_read"
  on public.print_jobs for select to authenticated
  using (public.can_manage_printing());

drop policy if exists "print_jobs_admin_insert" on public.print_jobs;
create policy "print_jobs_admin_insert"
  on public.print_jobs for insert to authenticated
  with check (public.can_manage_printing());

drop policy if exists "print_job_logs_admin_read" on public.print_job_logs;
create policy "print_job_logs_admin_read"
  on public.print_job_logs for select to authenticated
  using (public.can_manage_printing());

create or replace function public.set_pos_printer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_pos_printers_updated_at on public.pos_printers;
create trigger set_pos_printers_updated_at
  before update on public.pos_printers
  for each row execute procedure public.set_pos_printer_updated_at();

create or replace function public.create_print_job(
  p_printer_id uuid,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns public.print_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  printer_row public.pos_printers;
  created_job public.print_jobs;
  actor_role text := coalesce(public.normalize_profile_role(public.current_profile_role()), '');
begin
  if actor_role not in ('admin', 'gerente_general') then
    raise exception 'No tienes permiso para crear trabajos de impresion.';
  end if;

  select * into printer_row
  from public.pos_printers
  where id = p_printer_id
    and is_active = true;

  if printer_row.id is null then
    raise exception 'Impresora no encontrada o inactiva.';
  end if;

  if p_job_type <> any(printer_row.supported_job_types) then
    raise exception 'La impresora no soporta este tipo de impresion.';
  end if;

  insert into public.print_jobs (printer_id, job_type, payload, created_by)
  values (printer_row.id, p_job_type, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning * into created_job;

  insert into public.print_job_logs (print_job_id, status, message)
  values (created_job.id, 'pending', 'Trabajo de impresion creado.');

  return created_job;
end;
$$;

create or replace function public.get_pending_print_jobs(
  p_location text default null,
  p_limit integer default 10
)
returns table (
  id uuid,
  printer_id uuid,
  job_type text,
  payload jsonb,
  status text,
  attempts integer,
  created_at timestamptz,
  printer_name text,
  windows_printer_name text,
  location text,
  printer_type text,
  ip_address text,
  port integer,
  paper_width text
)
language sql
security definer
set search_path = ''
as $$
  select
    j.id,
    j.printer_id,
    j.job_type,
    j.payload,
    j.status,
    j.attempts,
    j.created_at,
    p.name as printer_name,
    p.windows_printer_name,
    p.location,
    p.printer_type,
    p.ip_address,
    p.port,
    p.paper_width
  from public.print_jobs j
  join public.pos_printers p on p.id = j.printer_id
  where auth.role() = 'service_role'
    and j.status = 'pending'
    and p.is_active = true
    and (nullif(trim(coalesce(p_location, '')), '') is null or lower(coalesce(p.location, '')) = lower(trim(p_location)))
  order by j.created_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

create or replace function public.mark_print_job_printing(p_job_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_job public.print_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el agente de impresion puede tomar trabajos.';
  end if;

  update public.print_jobs
  set status = 'printing',
      attempts = attempts + 1,
      error_message = null
  where id = p_job_id
    and status = 'pending'
  returning * into updated_job;

  if updated_job.id is not null then
    insert into public.print_job_logs(print_job_id, status, message)
    values (updated_job.id, 'printing', 'Trabajo tomado por print-agent.');
  end if;

  return updated_job;
end;
$$;

create or replace function public.mark_print_job_printed(p_job_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_job public.print_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el agente de impresion puede completar trabajos.';
  end if;

  update public.print_jobs
  set status = 'printed',
      error_message = null,
      printed_at = now()
  where id = p_job_id
  returning * into updated_job;

  if updated_job.id is not null then
    insert into public.print_job_logs(print_job_id, status, message)
    values (updated_job.id, 'printed', 'Trabajo impreso correctamente.');
  end if;

  return updated_job;
end;
$$;

create or replace function public.mark_print_job_failed(p_job_id uuid, p_error_message text)
returns public.print_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_job public.print_jobs;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Solo el agente de impresion puede marcar errores.';
  end if;

  update public.print_jobs
  set status = 'failed',
      error_message = left(coalesce(p_error_message, 'Error de impresion'), 1000)
  where id = p_job_id
  returning * into updated_job;

  if updated_job.id is not null then
    insert into public.print_job_logs(print_job_id, status, message)
    values (updated_job.id, 'failed', left(coalesce(p_error_message, 'Error de impresion'), 1000));
  end if;

  return updated_job;
end;
$$;

revoke all on function
  public.can_manage_printing(),
  public.create_print_job(uuid, text, jsonb),
  public.get_pending_print_jobs(text, integer),
  public.mark_print_job_printing(uuid),
  public.mark_print_job_printed(uuid),
  public.mark_print_job_failed(uuid, text)
from public;

grant execute on function
  public.can_manage_printing(),
  public.create_print_job(uuid, text, jsonb)
to authenticated;

grant execute on function
  public.get_pending_print_jobs(text, integer),
  public.mark_print_job_printing(uuid),
  public.mark_print_job_printed(uuid),
  public.mark_print_job_failed(uuid, text)
to service_role;
