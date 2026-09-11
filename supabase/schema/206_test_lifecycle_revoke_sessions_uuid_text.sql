-- Regression tests for 206_fix_lifecycle_revoke_sessions_uuid_text.sql
-- Entire file: BEGIN … ROLLBACK (no persistent data).

begin;

create or replace function public.test_lifecycle_revoke_sessions_uuid_text_206()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_def text;
  v_test_user uuid := '20600000-0000-4000-8000-000000000099'::uuid;
  v_token_count int;
  v_session_count int;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'revoke_user_auth_sessions';

  return query
  select
    '206-T1-refresh-tokens-text-cast'::text,
    position('user_id = p_user_id::text' in v_def) > 0
      and position('auth.refresh_tokens' in v_def) > 0,
    'refresh_tokens delete compares user_id with p_user_id::text'::text;

  return query
  select
    '206-T2-sessions-uuid-unchanged'::text,
    position('delete from auth.sessions where user_id = p_user_id;' in v_def) > 0,
    'sessions delete keeps uuid comparison'::text;

  return query
  select
    '206-T3-no-varchar-equals-uuid-on-refresh-tokens'::text,
    position('refresh_tokens where user_id = p_user_id;' in v_def) = 0,
    'refresh_tokens no longer uses bare uuid = varchar comparison'::text;

  return query
  select
    '206-T4-null-guard'::text,
    position('if p_user_id is null then' in v_def) > 0,
    'null p_user_id still rejected'::text;

  insert into auth.users (id, email, aud, role, created_at, updated_at)
  values (
    v_test_user,
    '206-revoke-test@stage-catering.test',
    'authenticated',
    'authenticated',
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values ('20600000-0000-4000-8000-000000000098'::uuid, v_test_user, now(), now())
  on conflict (id) do nothing;

  insert into auth.refresh_tokens (id, token, user_id, revoked, created_at, updated_at)
  values (
    nextval('auth.refresh_tokens_id_seq'),
    '206-test-token',
    v_test_user::text,
    false,
    now(),
    now()
  );

  perform public.revoke_user_auth_sessions(v_test_user);

  select count(*) into v_token_count
  from auth.refresh_tokens
  where user_id = v_test_user::text;

  select count(*) into v_session_count
  from auth.sessions
  where user_id = v_test_user;

  return query
  select
    '206-T5-runtime-revoke-clears-varchar-user-id'::text,
    v_token_count = 0 and v_session_count = 0,
    format('refresh_tokens=%s sessions=%s after revoke', v_token_count, v_session_count)::text;
end;
$$;

revoke all on function public.test_lifecycle_revoke_sessions_uuid_text_206() from public;
revoke all on function public.test_lifecycle_revoke_sessions_uuid_text_206() from anon;
revoke all on function public.test_lifecycle_revoke_sessions_uuid_text_206() from authenticated;
grant execute on function public.test_lifecycle_revoke_sessions_uuid_text_206() to service_role;

select scenario, passed, detail
from public.test_lifecycle_revoke_sessions_uuid_text_206()
order by scenario;

drop function if exists public.test_lifecycle_revoke_sessions_uuid_text_206();

rollback;
