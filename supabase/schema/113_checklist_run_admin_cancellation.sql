-- Admin cancellation metadata for checklist runs (logical cancel, preserve history).
-- Apply after 112_checklist_run_generation_hardening.sql.

alter table public.checklist_runs
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

drop policy if exists "checklist_session_audit_own_read" on public.checklist_session_audit;
create policy "checklist_session_audit_own_read"
  on public.checklist_session_audit for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_checklist_library_admin()
  );

create or replace function public.cancel_checklist_run_for_today(
  p_run_id uuid,
  p_cancel_reason text,
  p_force_completed boolean default false
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  previous_status text;
  actor_role text;
  template_title text;
begin
  if not public.is_checklist_library_admin() then
    raise exception 'No tienes permiso para cancelar checklists de hoy.';
  end if;

  if nullif(trim(coalesce(p_cancel_reason, '')), '') is null then
    raise exception 'El motivo de cancelacion es obligatorio.';
  end if;

  select public.normalize_profile_role(role) into actor_role
  from public.profiles
  where id = auth.uid();

  select * into run_row
  from public.checklist_runs
  where id = p_run_id
  for update;

  if run_row.id is null then
    raise exception 'Corrida no encontrada.';
  end if;

  if run_row.status = 'cancelled' then
    return run_row;
  end if;

  previous_status := run_row.status;

  if previous_status = 'completed' then
    if actor_role <> 'admin' or not coalesce(p_force_completed, false) then
      raise exception 'No se puede cancelar una checklist completada.';
    end if;
  end if;

  select title into template_title
  from public.checklist_templates
  where id = run_row.template_id;

  update public.checklist_runs
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = trim(p_cancel_reason),
      updated_at = now()
  where id = p_run_id
  returning * into run_row;

  insert into public.checklist_session_audit (profile_id, checklist_run_id, event_type, details)
  values (
    auth.uid(),
    run_row.id,
    'today_run_cancelled_by_admin',
    jsonb_build_object(
      'run_id', run_row.id,
      'template_id', run_row.template_id,
      'template_name', coalesce(template_title, ''),
      'cancelled_by', auth.uid(),
      'previous_status', previous_status,
      'cancel_reason', trim(p_cancel_reason),
      'timestamp', now()
    )
  );

  return run_row;
end;
$$;

create or replace function public.get_checklist_run_session_audit(p_run_id uuid)
returns setof public.checklist_session_audit
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.checklist_session_audit a
  where a.checklist_run_id = p_run_id
    and (
      a.profile_id = auth.uid()
      or public.is_checklist_library_admin()
    )
  order by a.created_at desc;
$$;

revoke all on function public.cancel_checklist_run_for_today(uuid, text, boolean) from public;
grant execute on function public.cancel_checklist_run_for_today(uuid, text, boolean) to authenticated;

revoke all on function public.get_checklist_run_session_audit(uuid) from public;
grant execute on function public.get_checklist_run_session_audit(uuid) to authenticated;
