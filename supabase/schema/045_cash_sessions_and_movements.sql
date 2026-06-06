-- Professional cash register sessions and movements.
-- Apply after 044_shift_types_and_custom_schedules.sql.

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers(id),
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2),
  difference numeric(12,2),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id),
  cash_register_id uuid not null references public.cash_registers(id),
  created_by uuid not null references public.profiles(id),
  authorized_by uuid references public.profiles(id),
  movement_type text not null check (
    movement_type in (
      'sale_cash', 'withdrawal', 'deposit', 'refund', 'adjustment',
      'manual_open', 'shift_open', 'shift_close'
    )
  ),
  amount numeric(12,2) not null default 0,
  reason text,
  order_id uuid,
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists cash_sessions_one_open_per_register_idx
  on public.cash_sessions (cash_register_id)
  where status = 'open';

create index if not exists cash_sessions_register_status_idx
  on public.cash_sessions (cash_register_id, status, opened_at desc);
create index if not exists cash_movements_session_time_idx
  on public.cash_movements (cash_session_id, created_at desc);
create index if not exists cash_movements_register_time_idx
  on public.cash_movements (cash_register_id, created_at desc);

insert into public.cash_registers (name, location, status)
select 'Caja Principal', 'Restaurante', 'active'
where not exists (
  select 1 from public.cash_registers where lower(trim(name)) = 'caja principal'
);

create or replace function public.is_cash_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
      and status = 'active'
  );
$$;

create or replace function public.is_cash_supervisor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor')
      and status = 'active'
  );
$$;

create or replace function public.is_cash_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor', 'cajero', 'caja')
      and status = 'active'
  );
$$;

revoke all on function public.is_cash_admin(), public.is_cash_supervisor(), public.is_cash_operator() from public;
grant execute on function public.is_cash_admin(), public.is_cash_supervisor(), public.is_cash_operator() to authenticated;

create or replace function public.calculate_cash_expected(p_cash_session_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (
    coalesce(max(s.opening_amount), 0)
    + coalesce(sum(case when m.movement_type = 'sale_cash' then m.amount else 0 end), 0)
    + coalesce(sum(case when m.movement_type = 'deposit' then m.amount else 0 end), 0)
    - coalesce(sum(case when m.movement_type = 'withdrawal' then m.amount else 0 end), 0)
    - coalesce(sum(case when m.movement_type = 'refund' then m.amount else 0 end), 0)
    + coalesce(sum(case when m.movement_type = 'adjustment' then m.amount else 0 end), 0)
  )::numeric(12,2)
  from public.cash_sessions s
  left join public.cash_movements m on m.cash_session_id = s.id
    and m.movement_type not in ('shift_open', 'shift_close', 'manual_open')
  where s.id = p_cash_session_id;
$$;

revoke all on function public.calculate_cash_expected(uuid) from public;
grant execute on function public.calculate_cash_expected(uuid) to authenticated;

create or replace function public.validate_cash_movement_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.cash_sessions;
begin
  select * into session_row
  from public.cash_sessions
  where id = new.cash_session_id;

  if session_row.id is null then
    raise exception 'La sesion de caja no existe.';
  end if;
  if session_row.status <> 'open' and new.movement_type <> 'shift_close' then
    raise exception 'No se permiten movimientos en sesiones cerradas.';
  end if;
  if new.cash_register_id is distinct from session_row.cash_register_id then
    raise exception 'El movimiento no coincide con la caja de la sesion.';
  end if;

  if new.movement_type in ('withdrawal', 'deposit') and (new.amount <= 0 or nullif(trim(coalesce(new.reason, '')), '') is null) then
    raise exception 'Retiro e ingreso requieren monto positivo y motivo.';
  end if;
  if new.movement_type = 'manual_open' and nullif(trim(coalesce(new.reason, '')), '') is null then
    raise exception 'La apertura manual requiere motivo.';
  end if;
  if new.movement_type in ('sale_cash', 'refund') and new.amount <= 0 then
    raise exception 'El movimiento requiere monto positivo.';
  end if;
  if new.movement_type in ('shift_open', 'shift_close', 'manual_open') and new.amount < 0 then
    raise exception 'Este movimiento no puede tener monto negativo.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_cash_movement_row on public.cash_movements;
create trigger validate_cash_movement_row
  before insert or update on public.cash_movements
  for each row execute procedure public.validate_cash_movement_row();

alter table public.cash_registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;

grant select, insert, update, delete on public.cash_registers to authenticated;
grant select on public.cash_sessions, public.cash_movements to authenticated;
grant insert, update on public.cash_sessions to authenticated;
grant insert on public.cash_movements to authenticated;
grant all on public.cash_registers, public.cash_sessions, public.cash_movements to service_role;

drop policy if exists "cash_registers_operator_read" on public.cash_registers;
create policy "cash_registers_operator_read" on public.cash_registers
  for select to authenticated using (public.is_cash_operator());

drop policy if exists "cash_registers_admin_insert" on public.cash_registers;
create policy "cash_registers_admin_insert" on public.cash_registers
  for insert to authenticated with check (public.is_cash_admin());

drop policy if exists "cash_registers_admin_update" on public.cash_registers;
create policy "cash_registers_admin_update" on public.cash_registers
  for update to authenticated using (public.is_cash_admin()) with check (public.is_cash_admin());

drop policy if exists "cash_registers_admin_delete" on public.cash_registers;
create policy "cash_registers_admin_delete" on public.cash_registers
  for delete to authenticated using (public.is_cash_admin());

drop policy if exists "cash_sessions_operator_read" on public.cash_sessions;
create policy "cash_sessions_operator_read" on public.cash_sessions
  for select to authenticated using (public.is_cash_operator());

drop policy if exists "cash_sessions_operator_insert" on public.cash_sessions;
create policy "cash_sessions_operator_insert" on public.cash_sessions
  for insert to authenticated with check (public.is_cash_operator() and opened_by = auth.uid());

drop policy if exists "cash_sessions_authorized_update" on public.cash_sessions;
create policy "cash_sessions_authorized_update" on public.cash_sessions
  for update to authenticated using (
    public.is_cash_supervisor()
    or (public.is_cash_operator() and opened_by = auth.uid() and status = 'open')
  ) with check (
    public.is_cash_supervisor()
    or (public.is_cash_operator() and opened_by = auth.uid())
  );

drop policy if exists "cash_movements_operator_read" on public.cash_movements;
create policy "cash_movements_operator_read" on public.cash_movements
  for select to authenticated using (public.is_cash_operator());

drop policy if exists "cash_movements_operator_insert" on public.cash_movements;
create policy "cash_movements_operator_insert" on public.cash_movements
  for insert to authenticated with check (
    public.is_cash_operator()
    and created_by = auth.uid()
    and exists (
      select 1 from public.cash_sessions s
      where s.id = cash_session_id
        and s.status = 'open'
        and s.cash_register_id = cash_register_id
    )
  );

create or replace function public.open_cash_session(
  p_cash_register_id uuid,
  p_opening_amount numeric,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  register_row public.cash_registers;
  saved public.cash_sessions;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para abrir caja.';
  end if;
  select * into register_row
  from public.cash_registers
  where id = p_cash_register_id and status = 'active';
  if register_row.id is null then
    raise exception 'La caja no existe o esta inactiva.';
  end if;
  if exists (
    select 1 from public.cash_sessions
    where cash_register_id = p_cash_register_id and status = 'open'
  ) then
    raise exception 'Ya existe una caja abierta.';
  end if;

  insert into public.cash_sessions (
    cash_register_id, opened_by, opening_amount, expected_cash, notes
  ) values (
    p_cash_register_id, auth.uid(), greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2),
    greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2), nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into saved;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values (
    saved.id, saved.cash_register_id, auth.uid(), 'shift_open', 0, 'Apertura de caja'
  );

  return saved;
end;
$$;

create or replace function public.create_cash_movement(
  p_cash_session_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reason text,
  p_reference text default null,
  p_order_id uuid default null
)
returns public.cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.cash_sessions;
  actor_role text;
  saved public.cash_movements;
  allowed_for_cashier text[] := array['deposit', 'sale_cash', 'refund'];
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para operar caja.';
  end if;

  select * into session_row
  from public.cash_sessions
  where id = p_cash_session_id
  for update;
  if session_row.id is null or session_row.status <> 'open' then
    raise exception 'No hay caja abierta.';
  end if;
  if p_movement_type not in ('sale_cash', 'withdrawal', 'deposit', 'refund', 'adjustment', 'manual_open') then
    raise exception 'Tipo de movimiento invalido.';
  end if;

  select public.normalize_profile_role(role) into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role in ('cajero', 'caja') and not (p_movement_type = any(allowed_for_cashier)) then
    raise exception 'Este movimiento requiere supervisor, Admin o Gerente General.';
  end if;
  if p_movement_type in ('withdrawal', 'manual_open', 'adjustment') and not public.is_cash_supervisor() then
    raise exception 'Este movimiento requiere supervisor, Admin o Gerente General.';
  end if;
  if p_movement_type in ('withdrawal', 'deposit', 'refund', 'adjustment', 'manual_open')
    and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'El motivo es obligatorio.';
  end if;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, authorized_by, movement_type,
    amount, reason, reference, order_id
  ) values (
    session_row.id, session_row.cash_register_id, auth.uid(),
    case when public.is_cash_supervisor() then auth.uid() else null end,
    p_movement_type,
    coalesce(p_amount, 0)::numeric(12,2),
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    p_order_id
  ) returning * into saved;

  update public.cash_sessions
  set expected_cash = public.calculate_cash_expected(session_row.id),
      updated_at = now()
  where id = session_row.id;

  return saved;
end;
$$;

create or replace function public.close_cash_session(
  p_cash_session_id uuid,
  p_counted_cash numeric,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.cash_sessions;
  expected numeric(12,2);
  saved public.cash_sessions;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para cerrar caja.';
  end if;

  select * into session_row
  from public.cash_sessions
  where id = p_cash_session_id
  for update;
  if session_row.id is null or session_row.status <> 'open' then
    raise exception 'No hay caja abierta.';
  end if;
  if not public.is_cash_supervisor() and session_row.opened_by <> auth.uid() then
    raise exception 'Solo puedes cerrar tu propia caja.';
  end if;

  expected := public.calculate_cash_expected(session_row.id);

  update public.cash_sessions
  set expected_cash = expected,
      counted_cash = coalesce(p_counted_cash, 0)::numeric(12,2),
      difference = (coalesce(p_counted_cash, 0)::numeric(12,2) - expected)::numeric(12,2),
      status = 'closed',
      closed_by = auth.uid(),
      closed_at = now(),
      notes = nullif(trim(coalesce(p_notes, notes, '')), ''),
      updated_at = now()
  where id = session_row.id
  returning * into saved;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values (
    saved.id, saved.cash_register_id, auth.uid(), 'shift_close', 0, 'Cierre de caja'
  );

  return saved;
end;
$$;

create or replace function public.record_cash_sale(p_order_id uuid, p_amount numeric)
returns public.cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.cash_sessions;
begin
  if not public.is_cash_operator() then
    raise exception 'No tienes permiso para registrar ventas en efectivo.';
  end if;
  select * into session_row
  from public.cash_sessions
  where status = 'open'
  order by opened_at desc
  limit 1;
  if session_row.id is null then
    raise exception 'No hay caja abierta. Abre caja antes de cobrar en efectivo.';
  end if;
  return public.create_cash_movement(
    session_row.id,
    'sale_cash',
    p_amount,
    'Venta en efectivo POS',
    p_order_id::text,
    p_order_id
  );
end;
$$;

revoke all on function
  public.open_cash_session(uuid,numeric,text),
  public.create_cash_movement(uuid,text,numeric,text,text,uuid),
  public.close_cash_session(uuid,numeric,text),
  public.record_cash_sale(uuid,numeric)
from public;

grant execute on function
  public.open_cash_session(uuid,numeric,text),
  public.create_cash_movement(uuid,text,numeric,text,text,uuid),
  public.close_cash_session(uuid,numeric,text),
  public.record_cash_sale(uuid,numeric)
to authenticated;
