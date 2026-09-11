-- 206: Fix lifecycle session revocation when auth.refresh_tokens.user_id is varchar.
-- Apply after 205_catering_ventas_operational_access.sql.
-- Root cause: revoke_user_auth_sessions compared auth.refresh_tokens.user_id (varchar)
-- with p_user_id (uuid), producing "operator does not exist: character varying = uuid".

begin;

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

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke all on function public.revoke_user_auth_sessions(uuid) from public;
grant execute on function public.revoke_user_auth_sessions(uuid) to service_role;

commit;
