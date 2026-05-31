-- Attendance terminal with protected PINs and mandatory photo evidence.
-- Apply after 018_purchase_order_notifications.sql.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists authorized_attendance_device text;

create table if not exists public.attendance_credentials (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_marks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee_name text not null,
  mark_type text not null check (mark_type in ('entrada', 'salida', 'bano_inicio', 'bano_regreso')),
  marked_at timestamptz not null default now(),
  photo_path text not null,
  device_id text not null,
  device_name text not null,
  device_alert boolean not null default false,
  related_mark_id uuid references public.attendance_marks(id),
  duration_minutes integer,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists attendance_marks_employee_time_idx
  on public.attendance_marks (employee_id, marked_at desc);
create index if not exists attendance_marks_time_idx
  on public.attendance_marks (marked_at desc);

alter table public.attendance_credentials enable row level security;
alter table public.attendance_marks enable row level security;

grant select on public.attendance_marks to authenticated;
grant all on public.attendance_credentials, public.attendance_marks to service_role;

create or replace function public.is_attendance_manager()
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
      and role in ('admin', 'gerente_general', 'rrhh')
      and status = 'active'
  );
$$;

revoke all on function public.is_attendance_manager() from public;
grant execute on function public.is_attendance_manager() to authenticated;

drop policy if exists "attendance_marks_managers_read" on public.attendance_marks;
create policy "attendance_marks_managers_read"
  on public.attendance_marks for select to authenticated
  using (public.is_attendance_manager() or employee_id = auth.uid());

create or replace function public.get_attendance_terminal_profiles()
returns table (
  id uuid,
  employee_code text,
  full_name text,
  avatar_url text,
  area_name text,
  pin_configured boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.employee_id,
    p.full_name,
    p.avatar_url,
    p.area_name,
    c.employee_id is not null
  from public.profiles p
  left join public.attendance_credentials c on c.employee_id = p.id
  where p.status = 'active'
  order by p.full_name nulls last, p.username;
$$;

revoke all on function public.get_attendance_terminal_profiles() from public;
grant execute on function public.get_attendance_terminal_profiles() to authenticated;

create or replace function public.get_attendance_terminal_marks()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  mark_type text,
  marked_at timestamptz,
  device_name text,
  device_alert boolean,
  related_mark_id uuid,
  duration_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id, m.employee_id, m.employee_name, m.mark_type, m.marked_at,
    m.device_name, m.device_alert, m.related_mark_id, m.duration_minutes
  from public.attendance_marks m
  where m.marked_at >= date_trunc('day', now() at time zone 'America/Guatemala') at time zone 'America/Guatemala'
  order by m.marked_at desc;
$$;

revoke all on function public.get_attendance_terminal_marks() from public;
grant execute on function public.get_attendance_terminal_marks() to authenticated;

create or replace function public.set_attendance_pin(
  p_employee_id uuid,
  p_pin text,
  p_authorized_device text default null
)
returns void
language plpgsql
security definer
set search_path = '', extensions, public
as $$
begin
  if not public.is_attendance_manager() then
    raise exception 'No tienes permiso para configurar PIN de marcaje.';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'El PIN debe contener entre 4 y 6 digitos.';
  end if;
  if exists (
    select 1
    from public.attendance_credentials c
    join public.profiles p on p.id = c.employee_id
    where c.employee_id <> p_employee_id
      and p.status = 'active'
      and crypt(p_pin, c.pin_hash) = c.pin_hash
  ) then
    raise exception 'El PIN ya esta asignado a otro colaborador activo.';
  end if;

  insert into public.attendance_credentials (employee_id, pin_hash, updated_by)
  values (p_employee_id, crypt(p_pin, gen_salt('bf')), auth.uid())
  on conflict (employee_id) do update
  set pin_hash = excluded.pin_hash,
      updated_by = excluded.updated_by,
      updated_at = now();

  update public.profiles
  set authorized_attendance_device = nullif(trim(p_authorized_device), ''),
      updated_at = now()
  where id = p_employee_id;
end;
$$;

revoke all on function public.set_attendance_pin(uuid,text,text) from public;
grant execute on function public.set_attendance_pin(uuid,text,text) to authenticated;

create or replace function public.set_attendance_device(p_employee_id uuid, p_authorized_device text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_attendance_manager() then
    raise exception 'No tienes permiso para configurar el dispositivo de marcaje.';
  end if;
  update public.profiles
  set authorized_attendance_device = nullif(trim(p_authorized_device), ''),
      updated_at = now()
  where id = p_employee_id;
end;
$$;

revoke all on function public.set_attendance_device(uuid,text) from public;
grant execute on function public.set_attendance_device(uuid,text) to authenticated;

create or replace function public.verify_attendance_pin(p_employee_id uuid, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = '', extensions, public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.attendance_credentials c on c.employee_id = p.id
    where p.id = p_employee_id
      and p.status = 'active'
      and crypt(p_pin, c.pin_hash) = c.pin_hash
  );
$$;

revoke all on function public.verify_attendance_pin(uuid,text) from public;
grant execute on function public.verify_attendance_pin(uuid,text) to authenticated;

create or replace function public.register_attendance_mark(
  p_employee_id uuid,
  p_pin text,
  p_mark_type text,
  p_photo_path text,
  p_device_id text,
  p_device_name text
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = '', extensions, public
as $$
declare
  employee public.profiles;
  credential public.attendance_credentials;
  mark public.attendance_marks;
  active_break public.attendance_marks;
  last_shift_mark public.attendance_marks;
  break_minutes integer;
  unrecognized_device boolean;
begin
  if nullif(trim(p_photo_path), '') is null then
    raise exception 'Se requiere foto para registrar asistencia.';
  end if;
  if p_mark_type not in ('entrada', 'salida', 'bano_inicio', 'bano_regreso') then
    raise exception 'Tipo de marcaje no valido.';
  end if;

  select * into employee
  from public.profiles
  where id = p_employee_id and status = 'active';
  select * into credential
  from public.attendance_credentials
  where employee_id = p_employee_id;

  if employee.id is null or credential.employee_id is null
    or crypt(p_pin, credential.pin_hash) <> credential.pin_hash then
    raise exception 'PIN incorrecto o colaborador sin PIN configurado.';
  end if;

  unrecognized_device := employee.authorized_attendance_device is not null
    and employee.authorized_attendance_device <> p_device_id;

  select shift_mark.* into last_shift_mark
  from public.attendance_marks shift_mark
  where shift_mark.employee_id = employee.id
    and shift_mark.mark_type in ('entrada', 'salida')
    and shift_mark.marked_at >= date_trunc('day', now() at time zone 'America/Guatemala') at time zone 'America/Guatemala'
  order by shift_mark.marked_at desc
  limit 1;

  select start_mark.* into active_break
  from public.attendance_marks start_mark
  where start_mark.employee_id = employee.id
    and start_mark.mark_type = 'bano_inicio'
    and not exists (
      select 1 from public.attendance_marks finish_mark
      where finish_mark.related_mark_id = start_mark.id
        and finish_mark.mark_type = 'bano_regreso'
    )
  order by start_mark.marked_at desc
  limit 1;

  if p_mark_type = 'entrada' and last_shift_mark.mark_type = 'entrada' then
    raise exception 'Ya existe una entrada activa para este colaborador.';
  elsif p_mark_type = 'salida' and (last_shift_mark.id is null or last_shift_mark.mark_type <> 'entrada') then
    raise exception 'No existe una entrada activa para registrar salida.';
  elsif p_mark_type = 'salida' and active_break.id is not null then
    raise exception 'Registra el regreso del break antes de marcar salida.';
  elsif p_mark_type = 'bano_inicio' and (last_shift_mark.id is null or last_shift_mark.mark_type <> 'entrada') then
    raise exception 'No existe una entrada activa para iniciar break.';
  elsif p_mark_type = 'bano_inicio' and active_break.id is not null then
    raise exception 'Ya existe un break activo para este colaborador.';
  end if;

  if p_mark_type = 'bano_regreso' then
    if active_break.id is null then
      raise exception 'No hay un break activo para registrar regreso.';
    end if;
    break_minutes := greatest(0, floor(extract(epoch from (now() - active_break.marked_at)) / 60)::integer);
  end if;

  insert into public.attendance_marks (
    employee_id, employee_name, mark_type, photo_path, device_id, device_name, device_alert,
    related_mark_id, duration_minutes
  )
  values (
    employee.id, coalesce(employee.full_name, employee.username, 'Colaborador'),
    p_mark_type, trim(p_photo_path), trim(p_device_id), trim(p_device_name), unrecognized_device,
    active_break.id, break_minutes
  )
  returning * into mark;

  return mark;
end;
$$;

revoke all on function public.register_attendance_mark(uuid,text,text,text,text,text) from public;
grant execute on function public.register_attendance_mark(uuid,text,text,text,text,text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attendance-evidence',
  'attendance-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attendance_evidence_authenticated_insert" on storage.objects;
create policy "attendance_evidence_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-evidence');

drop policy if exists "attendance_evidence_managers_read" on storage.objects;
create policy "attendance_evidence_managers_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'attendance-evidence' and public.is_attendance_manager());
