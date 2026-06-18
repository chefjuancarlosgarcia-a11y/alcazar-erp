-- Fix create_print_job job-type validation.
-- Bug: `p_job_type <> any(supported_job_types)` is TRUE when the job type matches
-- ANY element but differs from another (e.g. prebill <> test). Use `= any()` instead.
-- Apply after 097_catering_notification_roles.sql.

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
  normalized_job_type text := lower(trim(coalesce(p_job_type, '')));
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'supervisor', 'mesero', 'caja', 'cajero') then
    raise exception 'No tienes permiso para crear trabajos de impresion.';
  end if;

  if normalized_job_type = '' then
    raise exception 'Tipo de impresion invalido.';
  end if;

  select * into printer_row
  from public.pos_printers
  where id = p_printer_id
    and is_active = true;

  if printer_row.id is null then
    raise exception 'Impresora no encontrada o inactiva.';
  end if;

  if not (normalized_job_type = any(printer_row.supported_job_types)) then
    raise exception 'La impresora no soporta este tipo de impresion.';
  end if;

  insert into public.print_jobs (printer_id, job_type, payload, created_by)
  values (printer_row.id, normalized_job_type, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning * into created_job;

  insert into public.print_job_logs (print_job_id, status, message)
  values (created_job.id, 'pending', 'Trabajo de impresion creado.');

  return created_job;
end;
$$;

revoke all on function public.create_print_job(uuid, text, jsonb) from public;
grant execute on function public.create_print_job(uuid, text, jsonb) to authenticated, service_role;
