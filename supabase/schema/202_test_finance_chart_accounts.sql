-- Chart of accounts — SQL verification (NOT a migration).
-- Do NOT apply in Stage/Production deploy pipelines.
-- Run manually in Supabase SQL Editor AFTER 202_finance_accounting_chart_of_accounts.sql.
-- Uses BEGIN … ROLLBACK; safe on environments with finance Phase 1 applied.

begin;

create or replace function public.test_finance_chart_accounts()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_contador uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_gerente uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_a uuid;
  v_b uuid;
  v_child uuid;
  v_preview jsonb;
  v_import jsonb;
  v_count int;
  v_err text;
begin
  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin', 'admin_audit', 'admin', 'active'),
    (v_contador, 'Contador', 'contador_audit', 'contador', 'active'),
    (v_gerente, 'Gerente', 'gerente_audit', 'gerente_general', 'active'),
    (v_mesero, 'Mesero', 'mesero_audit', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.list_finance_chart_accounts();
    return query select 'admin_list'::text, true, 'list ok'::text;
  exception when others then
    return query select 'admin_list'::text, false, sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', '01.0010', 'name', 'Caja audit', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
    ));
    return query select 'admin_create'::text, true, 'create ok'::text;
  exception when others then
    return query select 'admin_create'::text, false, sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_contador::text, true);
  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', '01.0020', 'name', 'Banco audit', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
    ));
    return query select 'contador_create'::text, true, 'create ok'::text;
  exception when others then
    return query select 'contador_create'::text, false, sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    perform public.list_finance_chart_accounts();
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', '9', 'name', 'Should fail', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
    ));
    return query select 'gerente_read_only'::text, false, 'create should fail'::text;
  exception when others then
    return query select 'gerente_read_only'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  begin
    perform public.list_finance_chart_accounts();
    return query select 'gerente_list'::text, true, 'read ok'::text;
  exception when others then
    return query select 'gerente_list'::text, false, sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.list_finance_chart_accounts();
    return query select 'mesero_denied'::text, false, 'list should fail'::text;
  exception when others then
    return query select 'mesero_denied'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', '01.0010', 'name', 'Dup', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
    ));
    return query select 'duplicate_code'::text, false, 'should fail'::text;
  exception when others then
    return query select 'duplicate_code'::text, sqlerrm like '%ya existe%', sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'X1', 'name', 'Hija', 'parent_code', 'NO-EXISTE',
      'financial_type', 'asset', 'natural_balance', 'debit',
      'account_kind', 'detail', 'accepts_entries', true
    ));
    return query select 'missing_parent'::text, false, 'should fail'::text;
  exception when others then
    return query select 'missing_parent'::text, sqlerrm like '%padre%', sqlerrm;
  end;

  select id into v_a from public.finance_chart_accounts where code = '01.0010';
  begin
    perform public.update_finance_chart_account(v_a, jsonb_build_object('parent_id', v_a::text));
    return query select 'self_parent'::text, false, 'should fail'::text;
  exception when others then
    return query select 'self_parent'::text, sqlerrm like '%propio padre%', sqlerrm;
  end;

  perform public.create_finance_chart_account(jsonb_build_object(
    'code', 'CYA', 'name', 'Cycle A', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'header', 'accepts_entries', false
  ));
  perform public.create_finance_chart_account(jsonb_build_object(
    'code', 'CYB', 'name', 'Cycle B', 'parent_code', 'CYA',
    'financial_type', 'asset', 'natural_balance', 'debit',
    'account_kind', 'header', 'accepts_entries', false
  ));
  select id into v_b from public.finance_chart_accounts where code = 'CYB';
  begin
    perform public.update_finance_chart_account(
      (select id from public.finance_chart_accounts where code = 'CYA'),
      jsonb_build_object('parent_id', v_b::text)
    );
    return query select 'indirect_cycle'::text, false, 'should fail'::text;
  exception when others then
    return query select 'indirect_cycle'::text, sqlerrm like '%ciclo%', sqlerrm;
  end;

  v_preview := public.preview_finance_chart_accounts_import(jsonb_build_array(jsonb_build_object(
    'codigo', 'H1', 'nombre', 'Header bad', 'codigo_padre', '',
    'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'header',
    'acepta_movimientos', 'true', 'descripcion', ''
  )));
  return query select 'header_accepts_movements'::text,
    coalesce((v_preview ->> 'blocking_errors')::boolean, false) = true,
    v_preview ->> 'errors';

  v_import := public.import_finance_chart_accounts(jsonb_build_array(
    jsonb_build_object(
      'codigo', '10', 'nombre', 'Activos import', 'codigo_padre', '',
      'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'header',
      'acepta_movimientos', 'false', 'descripcion', ''
    ),
    jsonb_build_object(
      'codigo', '10.0001', 'nombre', 'Sub caja import', 'codigo_padre', '10',
      'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'detail',
      'acepta_movimientos', 'true', 'descripcion', ''
    )
  ));
  select count(*) into v_count from public.finance_chart_accounts where code in ('10', '10.0001');
  return query select 'valid_import_codes'::text,
    coalesce((v_import ->> 'imported')::int, 0) = 2 and v_count = 2,
    coalesce(v_import ->> 'imported', '0') || ' imported';

  return query select 'code_text_preserved'::text,
    exists(select 1 from public.finance_chart_accounts where code = '10.0001'),
    (select code from public.finance_chart_accounts where code = '10.0001');

  v_import := public.import_finance_chart_accounts(jsonb_build_array(
    jsonb_build_object(
      'codigo', '2', 'nombre', 'Pasivos', 'codigo_padre', '',
      'tipo_financiero', 'liability', 'naturaleza', 'credit', 'tipo_cuenta', 'header',
      'acepta_movimientos', 'false', 'descripcion', ''
    ),
    jsonb_build_object(
      'codigo', '2.01', 'nombre', 'Proveedores', 'codigo_padre', '2',
      'tipo_financiero', 'liability', 'naturaleza', 'credit', 'tipo_cuenta', 'detail',
      'acepta_movimientos', 'true', 'descripcion', ''
    )
  ));
  return query select 'parent_in_same_file'::text,
    coalesce((v_import ->> 'imported')::int, 0) = 2,
    coalesce(v_import ->> 'imported', '0');

  select count(*) into v_count from public.finance_chart_accounts;
  begin
    perform public.import_finance_chart_accounts(jsonb_build_array(
      jsonb_build_object(
        'codigo', '3', 'nombre', 'OK', 'codigo_padre', '',
        'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'header',
        'acepta_movimientos', 'false', 'descripcion', ''
      ),
      jsonb_build_object(
        'codigo', '3.01', 'nombre', '', 'codigo_padre', '3',
        'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'detail',
        'acepta_movimientos', 'true', 'descripcion', ''
      )
    ));
    return query select 'invalid_import_atomic'::text, false, 'should fail'::text;
  exception when others then
    v_err := sqlerrm;
    select count(*) into v_count from public.finance_chart_accounts where code like '3%';
    return query select 'invalid_import_atomic'::text, v_count = 0 and v_err like '%bloqueantes%', v_err;
  end;

  select id into v_child from public.finance_chart_accounts where code = '2.01';
  perform public.set_finance_chart_account_active(v_child, false);
  return query select 'deactivate_keeps_row'::text,
    exists(
      select 1 from public.finance_chart_accounts
      where id = v_child and is_active = false
    ),
    'is_active=false row exists';

  return query select 'delete_rejected'::text,
    not has_table_privilege('authenticated', 'public.finance_chart_accounts', 'DELETE')
    and not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'finance_chart_accounts'
        and cmd = 'DELETE'
    ),
    'authenticated lacks DELETE privilege and policy';

  return query select 'contador_role_seed'::text,
    exists(select 1 from public.user_roles where role_key = 'contador' and is_active),
    (select role_name from public.user_roles where role_key = 'contador');
end;
$$;

select * from public.test_finance_chart_accounts();

rollback;
