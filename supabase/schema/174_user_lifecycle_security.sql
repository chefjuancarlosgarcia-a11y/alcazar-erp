-- User lifecycle helpers: active-profile guard, operational history check, session revocation.
-- Apply after 173_profiles_termination_audit.sql.

create or replace function public.is_current_profile_active()
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
  );
$$;

revoke all on function public.is_current_profile_active() from public;
grant execute on function public.is_current_profile_active() to authenticated;

create or replace function public.profile_has_operational_history(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.attendance_marks where employee_id = p_profile_id)
    or exists (select 1 from public.pos_orders where waiter_id = p_profile_id)
    or exists (select 1 from public.cash_sessions where opened_by = p_profile_id)
    or exists (select 1 from public.cash_movements where created_by = p_profile_id)
    or exists (
      select 1 from public.requisitions
      where requested_by = p_profile_id
         or approved_by = p_profile_id
         or completed_by = p_profile_id
    )
    or exists (
      select 1 from public.checklist_runs
      where assigned_profile_id = p_profile_id
         or completed_by = p_profile_id
    )
    or exists (select 1 from public.employee_file_profiles where profile_id = p_profile_id)
    or exists (select 1 from public.employee_incidents where profile_id = p_profile_id)
    or exists (select 1 from public.checklist_management_alerts where sender_profile_id = p_profile_id)
    or exists (
      select 1 from public.catering_requests
      where created_by = p_profile_id
         or updated_by = p_profile_id
    )
    or exists (select 1 from public.inventory_movements where performed_by = p_profile_id)
    or exists (
      select 1 from public.production_batches
      where produced_by = p_profile_id
         or approved_by = p_profile_id
    )
    or exists (select 1 from public.checklist_session_audit where profile_id = p_profile_id)
    or exists (select 1 from public.yield_audits where employee_id = p_profile_id);
$$;

revoke all on function public.profile_has_operational_history(uuid) from public;
grant execute on function public.profile_has_operational_history(uuid) to service_role;

create or replace function public.revoke_user_auth_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'user_id requerido';
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke all on function public.revoke_user_auth_sessions(uuid) from public;
grant execute on function public.revoke_user_auth_sessions(uuid) to service_role;
