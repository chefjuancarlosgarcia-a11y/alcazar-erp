-- ROLLBACK 217 — Estado de Resultados.
-- Forward path: supabase/schema/217_finance_income_statement.sql
--
-- Restores catalog RPC bodies from 203/202 before dropping
-- income_statement_section. Does not delete journal entries, lines,
-- accounts, periods, Libro Diario, Libro Mayor or Balanza.
-- Does not GRANT report permissions. Idempotent.
\set ON_ERROR_STOP on

begin;

do $guard$
declare
  v_env text := lower(coalesce(
    (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
    ''
  ));
  v_stored_ref text := nullif(trim(coalesce(
    (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
    ''
  )), '');
  v_session_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
begin
  if v_env in ('production', 'prod') then
    raise exception '217 rollback blocked: production environment';
  end if;
  if v_env = 'stage' then
    if v_session_ref is null then
      raise exception '217 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
    end if;
    if v_stored_ref is null then
      raise exception '217 rollback blocked: deployment_environment.project_ref missing';
    end if;
    if v_session_ref <> v_stored_ref then
      raise exception '217 rollback blocked: session project ref does not match stored value';
    end if;
  end if;
end $guard$;

create or replace function public.finance_chart_account_row_to_json(p_row public.finance_chart_accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'code', p_row.code,
    'name', p_row.name,
    'parent_id', p_row.parent_id,
    'parent_code', (select parent.code from public.finance_chart_accounts parent where parent.id = p_row.parent_id),
    'level', p_row.level,
    'financial_type', p_row.financial_type,
    'natural_balance', p_row.natural_balance,
    'account_kind', p_row.account_kind,
    'accepts_entries', p_row.accepts_entries,
    'is_active', p_row.is_active,
    'description', p_row.description,
    'branch_dimension_rule', p_row.branch_dimension_rule,
    'cost_center_dimension_rule', p_row.cost_center_dimension_rule,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by,
    'has_children', exists (
      select 1 from public.finance_chart_accounts child where child.parent_id = p_row.id
    )
  );
$$;

create or replace function public.create_finance_chart_account(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.finance_chart_account_normalize_code(p_data ->> 'code');
  v_name text := nullif(trim(coalesce(p_data ->> 'name', '')), '');
  v_parent_id uuid := nullif(p_data ->> 'parent_id', '')::uuid;
  v_parent_code text := public.finance_chart_account_normalize_code(p_data ->> 'parent_code');
  v_financial_type text := lower(trim(coalesce(p_data ->> 'financial_type', '')));
  v_natural_balance text := lower(trim(coalesce(p_data ->> 'natural_balance', '')));
  v_account_kind text := lower(trim(coalesce(p_data ->> 'account_kind', '')));
  v_accepts_entries boolean := coalesce((p_data ->> 'accepts_entries')::boolean, false);
  v_description text := coalesce(nullif(trim(p_data ->> 'description'), ''), '');
  v_branch_rule text;
  v_cost_center_rule text;
  v_level smallint;
  v_row public.finance_chart_accounts;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para administrar el catálogo contable.';
  end if;
  if v_code is null then raise exception 'El código es obligatorio.'; end if;
  if v_name is null then raise exception 'El nombre es obligatorio.'; end if;
  if v_financial_type not in ('asset', 'liability', 'equity', 'income', 'cost', 'expense') then
    raise exception 'Tipo financiero inválido.';
  end if;
  if v_natural_balance not in ('debit', 'credit') then
    raise exception 'Naturaleza inválida.';
  end if;
  if v_account_kind not in ('header', 'detail') then
    raise exception 'Tipo de cuenta inválido.';
  end if;
  if v_account_kind = 'header' then
    v_accepts_entries := false;
  end if;

  if v_parent_id is null and v_parent_code is not null then
    select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
    if not found then raise exception 'La cuenta padre % no existe.', v_parent_code; end if;
  end if;

  perform public.finance_chart_account_assert_no_cycle(null, v_parent_id);
  v_level := public.finance_chart_account_parent_level(v_parent_id) + 1;

  if exists (select 1 from public.finance_chart_accounts where code = v_code) then
    raise exception 'El código % ya existe en el catálogo contable.', v_code;
  end if;

  v_branch_rule := public.finance_chart_account_validate_dimension_rule(
    coalesce(
      nullif(trim(p_data ->> 'branch_dimension_rule'), ''),
      public.finance_chart_account_default_branch_dimension_rule(v_financial_type)
    )
  );
  v_cost_center_rule := public.finance_chart_account_validate_dimension_rule(
    coalesce(
      nullif(trim(p_data ->> 'cost_center_dimension_rule'), ''),
      public.finance_chart_account_default_cost_center_dimension_rule(v_financial_type)
    )
  );

  insert into public.finance_chart_accounts (
    code, name, parent_id, level, financial_type, natural_balance,
    account_kind, accepts_entries, description,
    branch_dimension_rule, cost_center_dimension_rule,
    created_by, updated_by
  )
  values (
    v_code, v_name, v_parent_id, v_level, v_financial_type, v_natural_balance,
    v_account_kind, v_accepts_entries, v_description,
    v_branch_rule, v_cost_center_rule,
    auth.uid(), auth.uid()
  )
  returning * into v_row;

  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

create or replace function public.update_finance_chart_account(p_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_chart_accounts;
  v_parent_id uuid;
  v_parent_code text;
  v_account_kind text;
  v_accepts_entries boolean;
  v_has_children boolean;
  v_financial_type text;
  v_branch_rule text;
  v_cost_center_rule text;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para administrar el catálogo contable.';
  end if;

  select * into v_row from public.finance_chart_accounts where id = p_id for update;
  if not found then raise exception 'Cuenta contable no encontrada.'; end if;

  select exists(select 1 from public.finance_chart_accounts where parent_id = p_id)
  into v_has_children;

  v_parent_id := v_row.parent_id;
  if p_data ? 'parent_id' then
    v_parent_id := nullif(p_data ->> 'parent_id', '')::uuid;
  end if;
  v_parent_code := public.finance_chart_account_normalize_code(p_data ->> 'parent_code');
  if v_parent_id is null and v_parent_code is not null then
    select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
    if not found then raise exception 'La cuenta padre % no existe.', v_parent_code; end if;
  end if;

  perform public.finance_chart_account_assert_no_cycle(p_id, v_parent_id);

  v_account_kind := coalesce(lower(trim(p_data ->> 'account_kind')), v_row.account_kind);
  v_accepts_entries := coalesce((p_data ->> 'accepts_entries')::boolean, v_row.accepts_entries);
  v_financial_type := coalesce(lower(trim(p_data ->> 'financial_type')), v_row.financial_type);

  if v_has_children then
    if v_account_kind <> 'header' then
      raise exception 'Las cuentas con subcuentas deben permanecer como acumuladoras (header).';
    end if;
    v_accepts_entries := false;
  elsif v_account_kind = 'header' then
    v_accepts_entries := false;
  end if;

  v_branch_rule := v_row.branch_dimension_rule;
  if p_data ? 'branch_dimension_rule' then
    v_branch_rule := public.finance_chart_account_validate_dimension_rule(p_data ->> 'branch_dimension_rule');
  end if;
  v_cost_center_rule := v_row.cost_center_dimension_rule;
  if p_data ? 'cost_center_dimension_rule' then
    v_cost_center_rule := public.finance_chart_account_validate_dimension_rule(p_data ->> 'cost_center_dimension_rule');
  end if;

  update public.finance_chart_accounts
  set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    parent_id = v_parent_id,
    level = public.finance_chart_account_parent_level(v_parent_id) + 1,
    financial_type = v_financial_type,
    natural_balance = coalesce(lower(trim(p_data ->> 'natural_balance')), natural_balance),
    account_kind = v_account_kind,
    accepts_entries = v_accepts_entries,
    description = coalesce(nullif(trim(p_data ->> 'description'), ''), description),
    branch_dimension_rule = v_branch_rule,
    cost_center_dimension_rule = v_cost_center_rule,
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

create or replace function public.preview_finance_chart_accounts_import(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_idx int := 0;
  v_results jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_row_errors jsonb;
  v_code text;
  v_parent_code text;
  v_codes_in_file text[] := '{}';
  v_seen text[] := '{}';
  v_blocking int := 0;
  v_valid int := 0;
  v_financial_type text;
  v_natural_balance text;
  v_account_kind text;
  v_accepts_entries boolean;
  v_parent_exists boolean;
  v_db_exists boolean;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para importar el catálogo contable.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Se esperaba un arreglo de filas.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo');
    if v_code is not null then
      v_codes_in_file := array_append(v_codes_in_file, v_code);
    end if;
  end loop;

  v_idx := 0;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_row_errors := '[]'::jsonb;
    v_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo');
    v_parent_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo_padre');
    v_financial_type := lower(trim(coalesce(v_row ->> 'tipo_financiero', '')));
    v_natural_balance := lower(trim(coalesce(v_row ->> 'naturaleza', '')));
    v_account_kind := lower(trim(coalesce(v_row ->> 'tipo_cuenta', '')));
    v_accepts_entries := lower(trim(coalesce(v_row ->> 'acepta_movimientos', ''))) in ('true', '1', 'si', 'sí', 'yes');

    v_results := v_results || jsonb_build_array(jsonb_build_object('row_number', v_idx));

    if v_code is null then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo', 'message', 'El código es obligatorio.'));
    elsif v_code = any(v_seen) then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo', 'message', 'Código duplicado dentro del archivo.'));
    else
      v_seen := array_append(v_seen, v_code);
      select exists(select 1 from public.finance_chart_accounts where code = v_code) into v_db_exists;
      if v_db_exists then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo', 'message', 'El código ya existe en el catálogo.'));
      end if;
    end if;

    if nullif(trim(coalesce(v_row ->> 'nombre', '')), '') is null then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'nombre', 'message', 'El nombre es obligatorio.'));
    end if;

    if v_financial_type not in ('asset', 'liability', 'equity', 'income', 'cost', 'expense') then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'tipo_financiero', 'message', 'Tipo financiero inválido.'));
    end if;
    if v_natural_balance not in ('debit', 'credit') then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'naturaleza', 'message', 'Naturaleza inválida.'));
    end if;
    if v_account_kind not in ('header', 'detail') then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'tipo_cuenta', 'message', 'Tipo de cuenta inválido.'));
    end if;
    if v_account_kind = 'header' and v_accepts_entries then
      v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'acepta_movimientos', 'message', 'Las cuentas acumuladoras no aceptan movimientos.'));
    end if;

    if v_parent_code is not null then
      select exists(select 1 from public.finance_chart_accounts where code = v_parent_code) into v_parent_exists;
      if not v_parent_exists and not (v_parent_code = any(v_codes_in_file)) then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo_padre', 'message', 'La cuenta padre no existe en el archivo ni en el catálogo.'));
      end if;
      if v_code is not null and v_parent_code = v_code then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo_padre', 'message', 'Una cuenta no puede ser su propio padre.'));
      elsif v_code is not null and public.finance_chart_import_would_cycle(v_code, v_parent_code, p_rows) then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object('row_number', v_idx, 'field', 'codigo_padre', 'message', 'La jerarquía del archivo genera un ciclo.'));
      end if;
    end if;

    if jsonb_array_length(v_row_errors) > 0 then
      v_errors := v_errors || v_row_errors;
    else
      v_valid := v_valid + 1;
    end if;
  end loop;

  v_blocking := jsonb_array_length(v_errors);

  return jsonb_build_object(
    'rows_read', v_idx,
    'valid_rows', v_valid,
    'error_rows', (
      select count(distinct (err ->> 'row_number')::int)
      from jsonb_array_elements(v_errors) err
    ),
    'new_accounts', case when v_blocking = 0 then v_idx else 0 end,
    'duplicates', (
      select count(*) from jsonb_array_elements(v_errors) err
      where err ->> 'message' like '%duplicado%' or err ->> 'message' like '%ya existe%'
    ),
    'blocking_errors', v_blocking > 0,
    'errors', v_errors
  );
end;
$$;

create or replace function public.import_finance_chart_accounts(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
  v_row jsonb;
  v_code text;
  v_parent_code text;
  v_parent_id uuid;
  v_financial_type text;
  v_id_map jsonb := '{}'::jsonb;
  v_inserted int := 0;
  v_sorted jsonb;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para importar el catálogo contable.';
  end if;

  v_preview := public.preview_finance_chart_accounts_import(p_rows);
  if coalesce((v_preview ->> 'blocking_errors')::boolean, false) then
    raise exception 'La importación contiene errores bloqueantes. Corrige el archivo e inténtalo de nuevo.';
  end if;

  v_sorted := public.finance_chart_import_sort_rows(p_rows);

  for v_row in select value from jsonb_array_elements(v_sorted) loop
    v_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo');
    v_parent_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo_padre');
    v_financial_type := lower(trim(v_row ->> 'tipo_financiero'));
    v_parent_id := null;

    if v_parent_code is not null then
      select id into v_parent_id from public.finance_chart_accounts where code = v_parent_code;
      if v_parent_id is null then
        v_parent_id := nullif(v_id_map ->> v_parent_code, '')::uuid;
      end if;
      if v_parent_id is null then
        raise exception 'No se pudo resolver la cuenta padre % durante la importación.', v_parent_code;
      end if;
    end if;

    insert into public.finance_chart_accounts (
      code, name, parent_id, level, financial_type, natural_balance,
      account_kind, accepts_entries, description,
      branch_dimension_rule, cost_center_dimension_rule,
      created_by, updated_by
    )
    values (
      v_code,
      trim(v_row ->> 'nombre'),
      v_parent_id,
      public.finance_chart_account_parent_level(v_parent_id) + 1,
      v_financial_type,
      lower(trim(v_row ->> 'naturaleza')),
      lower(trim(v_row ->> 'tipo_cuenta')),
      case
        when lower(trim(v_row ->> 'tipo_cuenta')) = 'header' then false
        else lower(trim(coalesce(v_row ->> 'acepta_movimientos', ''))) in ('true', '1', 'si', 'sí', 'yes')
      end,
      coalesce(nullif(trim(v_row ->> 'descripcion'), ''), ''),
      public.finance_chart_account_default_branch_dimension_rule(v_financial_type),
      public.finance_chart_account_default_cost_center_dimension_rule(v_financial_type),
      auth.uid(),
      auth.uid()
    )
    returning id into v_parent_id;

    v_id_map := v_id_map || jsonb_build_object(v_code, v_parent_id::text);
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'imported', v_inserted,
    'preview', v_preview
  );
end;
$$;

do $drop_income$
begin
  if to_regprocedure('public.get_finance_income_statement(date,date,uuid,uuid,uuid,boolean,timestamptz)') is not null then
    revoke all on function public.get_finance_income_statement(
      date, date, uuid, uuid, uuid, boolean, timestamptz
    ) from public, anon, authenticated, service_role;
  end if;
  if to_regprocedure('public.finance_chart_account_classify_income_statement_section(text,text,text)') is not null then
    revoke all on function public.finance_chart_account_classify_income_statement_section(text, text, text)
      from public, anon, authenticated, service_role;
  end if;
end $drop_income$;

drop function if exists public.get_finance_income_statement(
  date, date, uuid, uuid, uuid, boolean, timestamptz
);

drop function if exists public.finance_chart_account_classify_income_statement_section(text, text, text);

alter table public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_income_statement_section_check;

alter table public.finance_chart_accounts
  drop column if exists income_statement_section;

commit;
