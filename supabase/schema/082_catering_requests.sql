-- Catering module: inbound quote requests from Wix and ERP workflow.
-- Apply after 081_attendance_status_and_all_blocks.sql.
-- Future tables (planned): catering_quotes, catering_events, catering_payments.

create extension if not exists pgcrypto;

create table if not exists public.catering_requests (
  id uuid primary key default gen_random_uuid(),

  customer_name text not null,
  customer_phone text,
  customer_email text,

  event_date date,
  event_time time,
  event_location text,
  event_type text,
  guest_count integer check (guest_count is null or guest_count >= 0),

  products_requested text[] not null default '{}',
  notes text,

  status text not null default 'new'
    check (status in (
      'new',
      'reviewing',
      'quoted',
      'sent',
      'approved',
      'rejected',
      'converted'
    )),
  source text not null default 'wix_form',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists catering_requests_status_idx
  on public.catering_requests (status);

create index if not exists catering_requests_event_date_idx
  on public.catering_requests (event_date);

create index if not exists catering_requests_customer_phone_idx
  on public.catering_requests (customer_phone);

create index if not exists catering_requests_created_at_idx
  on public.catering_requests (created_at desc);

create index if not exists catering_requests_status_created_idx
  on public.catering_requests (status, created_at desc);

alter table public.catering_requests enable row level security;

grant select, insert, update, delete on public.catering_requests to authenticated;
grant all on public.catering_requests to service_role;

create or replace function public.can_manage_catering_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        public.normalize_profile_role(profile.role) in (
          'admin',
          'gerente_general',
          'gerente',
          'gerente_operaciones',
          'supervisor'
        )
        or profile.role in (
          'admin',
          'gerente_general',
          'gerente',
          'gerente_operaciones',
          'supervisor'
        )
      )
  );
$$;

revoke all on function public.can_manage_catering_requests() from public;
grant execute on function public.can_manage_catering_requests() to authenticated;

create or replace function public.set_catering_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_catering_request_updated_at on public.catering_requests;
create trigger set_catering_request_updated_at
  before update on public.catering_requests
  for each row execute procedure public.set_catering_request_updated_at();

drop policy if exists "catering_requests_select" on public.catering_requests;
create policy "catering_requests_select"
  on public.catering_requests
  for select
  to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_requests_insert" on public.catering_requests;
create policy "catering_requests_insert"
  on public.catering_requests
  for insert
  to authenticated
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_requests_update" on public.catering_requests;
create policy "catering_requests_update"
  on public.catering_requests
  for update
  to authenticated
  using (public.can_manage_catering_requests())
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_requests_delete" on public.catering_requests;
create policy "catering_requests_delete"
  on public.catering_requests
  for delete
  to authenticated
  using (public.can_manage_catering_requests());

create or replace function public.create_catering_request(p_data jsonb)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_row public.catering_requests;
begin
  if auth.uid() is not null and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear solicitudes de catering.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
  end if;

  insert into public.catering_requests (
    customer_name,
    customer_phone,
    customer_email,
    event_date,
    event_time,
    event_location,
    event_type,
    guest_count,
    products_requested,
    notes,
    status,
    source,
    created_by,
    updated_by
  )
  values (
    v_customer_name,
    nullif(trim(coalesce(p_data ->> 'customer_phone', '')), ''),
    nullif(trim(coalesce(p_data ->> 'customer_email', '')), ''),
    nullif(p_data ->> 'event_date', '')::date,
    nullif(p_data ->> 'event_time', '')::time,
    nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    nullif(p_data ->> 'guest_count', '')::integer,
    coalesce(
      (
        select array_agg(value)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p_data -> 'products_requested') = 'array' then p_data -> 'products_requested'
            else '[]'::jsonb
          end
        ) as value
        where nullif(trim(value), '') is not null
      ),
      '{}'::text[]
    ),
    nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    coalesce(nullif(trim(coalesce(p_data ->> 'status', '')), ''), 'new'),
    coalesce(nullif(trim(coalesce(p_data ->> 'source', '')), ''), 'wix_form'),
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_catering_request_status(
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar solicitudes de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if v_status is null then
    raise exception 'p_status es obligatorio.';
  end if;

  if v_status not in (
    'new', 'reviewing', 'quoted', 'sent', 'approved', 'rejected', 'converted'
  ) then
    raise exception 'Estado invalido: %', v_status;
  end if;

  update public.catering_requests request
  set
    status = v_status,
    notes = case
      when p_notes is null then request.notes
      when nullif(trim(p_notes), '') is null then request.notes
      when nullif(trim(coalesce(request.notes, '')), '') is null then trim(p_notes)
      else request.notes || E'\n' || trim(p_notes)
    end,
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

create or replace function public.get_catering_requests(
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns setof public.catering_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar solicitudes de catering.';
  end if;

  return query
  select request.*
  from public.catering_requests request
  where v_status is null or request.status = v_status
  order by request.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.get_catering_request_detail(p_request_id uuid)
returns public.catering_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar solicitudes de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  select request.*
  into v_row
  from public.catering_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.create_catering_request(jsonb) from public;
revoke all on function public.update_catering_request_status(uuid, text, text) from public;
revoke all on function public.get_catering_requests(text, integer, integer) from public;
revoke all on function public.get_catering_request_detail(uuid) from public;

grant execute on function public.create_catering_request(jsonb) to authenticated, service_role;
grant execute on function public.update_catering_request_status(uuid, text, text) to authenticated;
grant execute on function public.get_catering_requests(text, integer, integer) to authenticated;
grant execute on function public.get_catering_request_detail(uuid) to authenticated;

comment on table public.catering_requests is
  'Inbound catering quote requests. Source of truth before catering_quotes / catering_events.';

comment on column public.catering_requests.status is
  'Workflow: new -> reviewing -> quoted -> sent -> approved|rejected -> converted';

comment on column public.catering_requests.source is
  'Origin channel, e.g. wix_form, erp_manual, phone, email.';
