-- Diagnóstico manual: print_jobs pendientes para agente CAJA
-- IMPORTANTE: get_pending_print_jobs() exige auth.role() = 'service_role'.
-- En el SQL Editor de Supabase auth.role() suele ser 'authenticated' o 'postgres',
-- por lo que el RPC devuelve 0 filas aunque existan jobs pending.
-- Usa las queries "equivalent" de abajo en el SQL Editor, o prueba el RPC vía REST
-- con service role (como hace print-agent).

-- ---------------------------------------------------------------------------
-- 1) Equivalente EXACTO del RPC (sin guard auth.role) — usar en SQL Editor
-- ---------------------------------------------------------------------------
select
  j.id,
  j.job_type,
  j.status,
  j.attempts,
  j.created_at,
  j.printer_id,
  p.name as printer_name,
  p.windows_printer_name,
  p.location,
  p.is_active as printer_active
from public.print_jobs j
join public.pos_printers p on p.id = j.printer_id
where j.status = 'pending'
  and p.is_active = true
  and lower(coalesce(p.location, '')) = lower(trim('CAJA'))
order by j.created_at asc
limit 5;

-- ---------------------------------------------------------------------------
-- 2) ¿Hay más de 5 pending? (nuevos receipt quedan fuera del límite del agente)
-- ---------------------------------------------------------------------------
select
  count(*) as pending_total,
  count(*) filter (where j.job_type = 'receipt') as pending_receipt,
  count(*) filter (where j.job_type = 'prebill') as pending_prebill,
  count(*) filter (where j.job_type = 'test') as pending_test
from public.print_jobs j
join public.pos_printers p on p.id = j.printer_id
where j.status = 'pending'
  and p.is_active = true
  and lower(coalesce(p.location, '')) = lower(trim('CAJA'));

-- ---------------------------------------------------------------------------
-- 3) Todos los pending CAJA (sin límite) — ver orden y jobs bloqueados
-- ---------------------------------------------------------------------------
select
  j.id,
  j.job_type,
  j.status,
  j.created_at,
  row_number() over (order by j.created_at asc) as queue_position,
  p.location,
  p.windows_printer_name
from public.print_jobs j
join public.pos_printers p on p.id = j.printer_id
where j.status = 'pending'
  and p.is_active = true
  and lower(coalesce(p.location, '')) = lower(trim('CAJA'))
order by j.created_at asc;

-- ---------------------------------------------------------------------------
-- 4) Receipt pending específico — ¿matchea location e impresora activa?
-- ---------------------------------------------------------------------------
select
  j.id,
  j.job_type,
  j.status,
  j.created_at,
  j.error_message,
  p.id as printer_id,
  p.name,
  p.location,
  p.is_active,
  p.supported_job_types,
  lower(coalesce(p.location, '')) = lower(trim('CAJA')) as location_matches_caja
from public.print_jobs j
join public.pos_printers p on p.id = j.printer_id
where j.job_type = 'receipt'
  and j.status = 'pending'
order by j.created_at desc
limit 20;

-- ---------------------------------------------------------------------------
-- 5) Jobs atascados en printing (el agente no los reintenta)
-- ---------------------------------------------------------------------------
select
  j.id,
  j.job_type,
  j.status,
  j.attempts,
  j.created_at,
  j.error_message,
  p.location
from public.print_jobs j
join public.pos_printers p on p.id = j.printer_id
where j.status = 'printing'
order by j.created_at asc;

-- ---------------------------------------------------------------------------
-- 6) Probar RPC real (solo funciona con JWT service_role, no en SQL Editor)
-- curl ejemplo:
-- curl -X POST "$SUPABASE_URL/rest/v1/rpc/get_pending_print_jobs" \
--   -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--   -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--   -H "Content-Type: application/json" \
--   -d '{"p_location":"CAJA","p_limit":5}'
-- ---------------------------------------------------------------------------
-- select * from public.get_pending_print_jobs('CAJA', 5);
