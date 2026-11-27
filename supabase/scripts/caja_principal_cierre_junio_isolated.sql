-- Base local para ensayar el cierre. No apunta a producción.
-- Crea solo las tablas y funciones que el script de cierre lee y escribe.

create or replace function public.normalize_profile_role(role text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(role, '')));
$$;

create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  username text,
  role text,
  status text
);

create table if not exists public.cash_registers (
  id uuid primary key,
  name text not null
);

create table if not exists public.cash_sessions (
  id uuid primary key,
  cash_register_id uuid not null references public.cash_registers(id),
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(12,2) not null default 0,
  expected_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2),
  difference numeric(12,2),
  status text not null default 'open',
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
  movement_type text not null,
  amount numeric(12,2) not null default 0,
  reason text,
  order_id uuid,
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.calculate_cash_expected(p_cash_session_id uuid)
returns numeric
language sql
stable
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

create or replace function public.validate_cash_movement_row()
returns trigger
language plpgsql
as $$
declare
  session_status text;
begin
  select status into session_status
  from public.cash_sessions
  where id = new.cash_session_id;

  if session_status <> 'open' and new.movement_type <> 'shift_close' then
    raise exception 'No se permiten movimientos en sesiones cerradas.';
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
  for each row execute function public.validate_cash_movement_row();

create or replace function public.seed_caja_principal_junio(p_sale_delta numeric default 0)
returns void
language plpgsql
as $$
declare
  v_session uuid := 'e30a26a2-fa2a-45aa-a081-4b988a644548';
  v_register uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_opener uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_authorizer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  truncate table
    public.cash_movements,
    public.cash_sessions,
    public.cash_registers,
    public.profiles
  restart identity cascade;

  insert into public.profiles (id, full_name, username, role, status) values
    (v_authorizer, 'Autorizador de prueba', 'autorizador', 'admin', 'active'),
    (v_opener, 'Juan Carlos', 'juancarlos', 'admin', 'active');

  insert into public.cash_registers (id, name) values (v_register, 'Caja Principal');

  insert into public.cash_sessions (
    id, cash_register_id, opened_by, opening_amount, expected_cash, status, opened_at
  ) values (
    v_session, v_register, v_opener, 500.00, 500.00, 'open', '2026-06-06 12:00:00+00'
  );

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values (
    v_session, v_register, v_opener, 'shift_open', 0, 'Apertura de caja'
  );

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  )
  select v_session, v_register, v_opener, 'sale_cash',
         case when g = 1 then 145.00 + p_sale_delta else 145.00 end,
         'Venta de prueba'
  from generate_series(1, 40) as g;
end;
$$;

create or replace function public.seed_caja_principal_junio_cierre_extra()
returns void
language plpgsql
as $$
declare
  v_session uuid := 'e30a26a2-fa2a-45aa-a081-4b988a644548';
  v_register uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_authorizer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_note text := 'Cierre de sesión de pruebas de junio sin conteo físico histórico';
begin
  perform public.seed_caja_principal_junio(0);

  update public.cash_sessions
  set status = 'closed',
      expected_cash = 6300.00,
      counted_cash = null,
      difference = null,
      closed_by = v_authorizer,
      closed_at = '2026-11-24 18:00:00+00',
      notes = v_note
  where id = v_session;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values
    (v_session, v_register, v_authorizer, 'shift_close', 0, v_note),
    (v_session, v_register, v_authorizer, 'shift_close', 0, 'Otro motivo');
end;
$$;
