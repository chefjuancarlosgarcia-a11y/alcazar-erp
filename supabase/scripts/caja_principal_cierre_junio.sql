-- Cierre administrativo de la sesión histórica de Caja Principal.
-- No es una migración. No ejecutar hasta la aprobación explícita.
-- No usa el cierre normal de la aplicacion: ese convierte un conteo vacio en cero y graba diferencia.
-- No modifica pedidos, pagos, KDS ni inventario.
--
-- Historial revisado que debe coincidir antes de escribir el primer cierre:
--   sesión e30a26a2-fa2a-45aa-a081-4b988a644548
--   caja llamada Caja Principal
--   estado open
--   fondo inicial 500.00
--   1 movimiento shift_open
--   40 movimientos sale_cash por 5800.00 en total
--   cero movimientos de otros tipos
--   calculate_cash_expected = 6300.00
--
-- El registro local de Emy no está en esta base. Se contrasta con el archivo
-- caja-local-respaldo.json de su navegador: la fila local con status "open"
-- tiene id session-..., openingAmount, openedAt y cashierName. Ese fondo no
-- se copia a este cierre ni al turno nuevo.

-- ---------------------------------------------------------------------------
-- 1. Vista previa. Solo lectura. Ejecutar esta consulta antes del cierre.
-- ---------------------------------------------------------------------------

select
  r.name as caja,
  s.id,
  s.status,
  s.opening_amount as fondo_inicial,
  s.expected_cash as saldo_guardado,
  public.calculate_cash_expected(s.id) as saldo_calculado,
  (select count(*) from public.cash_movements m where m.cash_session_id = s.id and m.movement_type = 'shift_open') as shift_open,
  (select count(*) from public.cash_movements m where m.cash_session_id = s.id and m.movement_type = 'sale_cash') as sale_cash,
  (select coalesce(sum(m.amount), 0)::numeric(12,2) from public.cash_movements m where m.cash_session_id = s.id and m.movement_type = 'sale_cash') as total_sale_cash,
  (select count(*) from public.cash_movements m where m.cash_session_id = s.id and m.movement_type not in ('sale_cash', 'shift_open')) as otros,
  s.counted_cash,
  s.difference,
  s.opened_at,
  opener.full_name as responsable
from public.cash_sessions s
join public.cash_registers r on r.id = s.cash_register_id
join public.profiles opener on opener.id = s.opened_by
where s.id = 'e30a26a2-fa2a-45aa-a081-4b988a644548';

select
  m.movement_type,
  count(*) as movimientos,
  coalesce(sum(m.amount), 0)::numeric(12,2) as total
from public.cash_movements m
where m.cash_session_id = 'e30a26a2-fa2a-45aa-a081-4b988a644548'
group by m.movement_type
order by m.movement_type;

-- ---------------------------------------------------------------------------
-- 2. Cierre. Reemplazar el uuid cero por el id de profiles de quien autoriza.
-- Ese perfil debe existir, estar activo y ser admin, gerente_general o supervisor.
-- Una segunda ejecución reconoce el cierre y no inserta otro shift_close.
-- Ejecutar en el editor SQL de Supabase. La política de movimientos exige
-- created_by = auth.uid() para un usuario autenticado; este script guarda el
-- perfil autorizador y por eso corre con el rol que omite esas políticas.
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_session_id constant uuid := 'e30a26a2-fa2a-45aa-a081-4b988a644548';
  v_authorizer uuid := '00000000-0000-0000-0000-000000000000';
  v_note constant text := 'Cierre de sesión de pruebas de junio sin conteo físico histórico';
  v_session public.cash_sessions;
  v_register_name text;
  v_expected numeric(12,2);
  v_sale_count integer;
  v_sale_total numeric(12,2);
  v_shift_open integer;
  v_other integer;
  v_other_open integer;
  v_shift_close integer;
begin
  if v_authorizer = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Indicá el id verificable de quien autoriza el cierre.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_authorizer
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor')
  ) then
    raise exception 'El autorizador no existe o no puede cerrar esta caja.';
  end if;

  select * into v_session
  from public.cash_sessions
  where id = v_session_id
  for update;

  if v_session.id is null then
    raise exception 'La sesion historica no existe.';
  end if;

  select name into v_register_name
  from public.cash_registers
  where id = v_session.cash_register_id;

  if lower(trim(coalesce(v_register_name, ''))) <> 'caja principal' then
    raise exception 'La sesion no corresponde a Caja Principal.';
  end if;

  select count(*) into v_shift_open
  from public.cash_movements
  where cash_session_id = v_session_id
    and movement_type = 'shift_open';

  select count(*), coalesce(sum(amount), 0)::numeric(12,2)
  into v_sale_count, v_sale_total
  from public.cash_movements
  where cash_session_id = v_session_id
    and movement_type = 'sale_cash';

  select count(*) into v_other
  from public.cash_movements
  where cash_session_id = v_session_id
    and movement_type not in ('sale_cash', 'shift_open', 'shift_close');

  select count(*) into v_other_open
  from public.cash_movements
  where cash_session_id = v_session_id
    and movement_type not in ('sale_cash', 'shift_open');

  select count(*) into v_shift_close
  from public.cash_movements
  where cash_session_id = v_session_id
    and movement_type = 'shift_close'
    and amount = 0
    and reason = v_note
    and created_by = v_authorizer;

  v_expected := public.calculate_cash_expected(v_session_id);

  if v_session.status = 'closed'
     and v_session.opening_amount = 500.00
     and v_session.expected_cash = 6300.00
     and v_session.counted_cash is null
     and v_session.difference is null
     and v_session.closed_by = v_authorizer
     and coalesce(v_session.notes, '') like '%' || v_note || '%'
     and v_shift_open = 1
     and v_sale_count = 40
     and v_sale_total = 5800.00
     and v_other = 0
     and v_shift_close = 1
     and v_expected = 6300.00 then
    raise notice 'El cierre ya estaba registrado';
    return;
  end if;

  if v_session.status <> 'open' then
    raise exception 'El valor revisado difiere: estado esperado open, encontrado %.', v_session.status;
  end if;

  if v_session.opening_amount <> 500.00 then
    raise exception 'El valor revisado difiere: fondo esperado 500.00, encontrado %.', v_session.opening_amount;
  end if;

  if v_shift_open <> 1 then
    raise exception 'El valor revisado difiere: shift_open esperado 1, encontrado %.', v_shift_open;
  end if;

  if v_sale_count <> 40 then
    raise exception 'El valor revisado difiere: sale_cash esperado 40, encontrado %.', v_sale_count;
  end if;

  if v_sale_total <> 5800.00 then
    raise exception 'El valor revisado difiere: total sale_cash esperado 5800.00, encontrado %.', v_sale_total;
  end if;

  if v_other_open <> 0 then
    raise exception 'El valor revisado difiere: otros movimientos esperado 0, encontrado %.', v_other_open;
  end if;

  if v_expected <> 6300.00 then
    raise exception 'El valor revisado difiere: saldo esperado 6300.00, encontrado %.', v_expected;
  end if;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason
  ) values (
    v_session.id, v_session.cash_register_id, v_authorizer, 'shift_close', 0, v_note
  );

  update public.cash_sessions
  set expected_cash = 6300.00,
      counted_cash = null,
      difference = null,
      status = 'closed',
      closed_by = v_authorizer,
      closed_at = now(),
      notes = case
        when nullif(trim(coalesce(notes, '')), '') is null then v_note
        else notes || E'\n' || v_note
      end,
      updated_at = now()
  where id = v_session.id
    and status = 'open';

  if not exists (
    select 1
    from public.cash_sessions
    where id = v_session.id
      and status = 'closed'
      and counted_cash is null
      and difference is null
      and expected_cash = 6300.00
      and closed_by = v_authorizer
      and opening_amount = 500.00
  ) then
    raise exception 'El cierre no dejo el conteo vacio ni el saldo esperado 6300.00.';
  end if;

  if (select count(*) from public.cash_movements where cash_session_id = v_session.id and movement_type = 'sale_cash') <> 40
     or (select coalesce(sum(amount), 0)::numeric(12,2) from public.cash_movements where cash_session_id = v_session.id and movement_type = 'sale_cash') <> 5800.00
     or (select count(*) from public.cash_movements where cash_session_id = v_session.id and movement_type = 'shift_open') <> 1
     or (select count(*) from public.cash_movements where cash_session_id = v_session.id and movement_type = 'shift_close' and amount = 0 and reason = v_note and created_by = v_authorizer) <> 1 then
    raise exception 'El cierre altero el historial revisado.';
  end if;
end;
$$;

commit;

select
  s.status,
  s.opening_amount,
  s.expected_cash,
  s.counted_cash,
  s.difference,
  s.closed_at,
  closer.full_name as autorizado_por,
  s.notes
from public.cash_sessions s
left join public.profiles closer on closer.id = s.closed_by
where s.id = 'e30a26a2-fa2a-45aa-a081-4b988a644548';
