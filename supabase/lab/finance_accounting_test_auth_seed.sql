-- Finance accounting SQL test auth seed (lab / full-schema harness only).
-- Ensures auth.users + profiles exist for fixed audit UUIDs used by 202/203/204 tests.
-- Uses session_replication_role to bypass profile protection triggers in disposable labs only.
\set ON_ERROR_STOP on

insert into auth.users (id, aud, role, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'finance-audit-admin@test.local'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'finance-audit-contador@test.local'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'authenticated', 'authenticated', 'finance-audit-gerente@test.local'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'authenticated', 'authenticated', 'finance-audit-mesero@test.local'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'authenticated', 'authenticated', 'finance-audit-inactive@test.local')
on conflict (id) do nothing;

set session_replication_role = replica;

insert into public.profiles (id, full_name, username, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Audit', 'admin_audit', 'admin', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Contador Audit', 'contador_audit', 'contador', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Gerente Audit', 'gerente_audit', 'gerente_general', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mesero Audit', 'mesero_audit', 'mesero', 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Inactivo Audit', 'inactive_audit', 'contador', 'inactive')
on conflict (id) do update
set full_name = excluded.full_name,
    username = excluded.username,
    role = excluded.role,
    status = excluded.status;

set session_replication_role = default;

select set_config('request.jwt.claim.role', 'authenticated', true);

create or replace function public.finance_accounting_test_set_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

revoke all on function public.finance_accounting_test_set_user(uuid) from public;
grant execute on function public.finance_accounting_test_set_user(uuid) to postgres;
