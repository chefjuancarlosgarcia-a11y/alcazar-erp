-- Balance General.
-- Apply after 217_finance_income_statement.sql.
-- Number 218. Does not edit migrations 202-217 and does not write schema_migrations.
-- Adds balance_sheet_section (nullable, no backfill) and get_finance_balance_sheet.
-- Replaces the five catalog jsonb functions in place and preserves income_statement_section.

alter table public.finance_chart_accounts
  add column if not exists balance_sheet_section text;

alter table public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_balance_sheet_section_check;

alter table public.finance_chart_accounts
  add constraint finance_chart_accounts_balance_sheet_section_check
  check (
    balance_sheet_section is null
    or (
      account_kind = 'detail'
      and (
        (
          financial_type = 'asset'
          and balance_sheet_section in ('current_asset', 'noncurrent_asset')
        )
        or (
          financial_type = 'liability'
          and balance_sheet_section in ('current_liability', 'noncurrent_liability')
        )
        or (
          financial_type = 'equity'
          and balance_sheet_section = 'equity'
        )
      )
    )
  );

comment on column public.finance_chart_accounts.balance_sheet_section is
  'Sección explícita del Balance General. Nula hasta que el contador la asigne. No se deduce del código, nombre, padre ni naturaleza.';

create or replace function public.finance_chart_account_classify_balance_sheet_section(
  p_financial_type text,
  p_account_kind text,
  p_raw text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text := nullif(lower(trim(coalesce(p_raw, ''))), '');
  v_section text;
  v_type text := lower(trim(coalesce(p_financial_type, '')));
  v_kind text := lower(trim(coalesce(p_account_kind, '')));
  v_warning text := 'La cuenta podrá recibir movimientos, pero el Balance General permanecerá incompleto hasta clasificarla.';
begin
  if v_raw is null then
    if v_kind = 'detail' and v_type in ('asset', 'liability', 'equity') then
      return jsonb_build_object('section', null, 'error', null, 'warning', v_warning);
    end if;
    return jsonb_build_object('section', null, 'error', null, 'warning', null);
  end if;

  v_section := case v_raw
    when 'current_asset' then 'current_asset'
    when 'activo corriente' then 'current_asset'
    when 'noncurrent_asset' then 'noncurrent_asset'
    when 'activo no corriente' then 'noncurrent_asset'
    when 'current_liability' then 'current_liability'
    when 'pasivo corriente' then 'current_liability'
    when 'noncurrent_liability' then 'noncurrent_liability'
    when 'pasivo no corriente' then 'noncurrent_liability'
    when 'equity' then 'equity'
    when 'patrimonio' then 'equity'
    else null
  end;

  if v_section is null then
    return jsonb_build_object('section', null, 'error', 'Sección del Balance General desconocida.', 'warning', null);
  end if;
  if v_kind = 'header' then
    return jsonb_build_object('section', null, 'error', 'Las cuentas acumuladoras no llevan sección del Balance General.', 'warning', null);
  end if;
  if v_type in ('income', 'cost', 'expense') then
    return jsonb_build_object('section', null, 'error', 'Las cuentas de resultados no llevan sección del Balance General.', 'warning', null);
  end if;
  if not (
    (v_type = 'asset' and v_section in ('current_asset', 'noncurrent_asset'))
    or (v_type = 'liability' and v_section in ('current_liability', 'noncurrent_liability'))
    or (v_type = 'equity' and v_section = 'equity')
  ) then
    return jsonb_build_object('section', null, 'error', 'La sección del Balance General no corresponde al tipo financiero.', 'warning', null);
  end if;

  return jsonb_build_object('section', v_section, 'error', null, 'warning', null);
end;
$$;

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
    'income_statement_section', p_row.income_statement_section,
    'balance_sheet_section', p_row.balance_sheet_section,
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
  v_class jsonb;
  v_section text;
  v_balance_class jsonb;
  v_balance_section text;
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

  v_class := public.finance_chart_account_classify_income_statement_section(
    v_financial_type,
    v_account_kind,
    case when p_data ? 'income_statement_section' then p_data ->> 'income_statement_section' else null end
  );
  if v_class ->> 'error' is not null then
    raise exception '%', v_class ->> 'error';
  end if;
  v_section := v_class ->> 'section';

  v_balance_class := public.finance_chart_account_classify_balance_sheet_section(
    v_financial_type,
    v_account_kind,
    case when p_data ? 'balance_sheet_section' then p_data ->> 'balance_sheet_section' else null end
  );
  if v_balance_class ->> 'error' is not null then
    raise exception '%', v_balance_class ->> 'error';
  end if;
  v_balance_section := v_balance_class ->> 'section';

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
    income_statement_section,
    balance_sheet_section,
    created_by, updated_by
  )
  values (
    v_code, v_name, v_parent_id, v_level, v_financial_type, v_natural_balance,
    v_account_kind, v_accepts_entries, v_description,
    v_branch_rule, v_cost_center_rule,
    v_section,
    v_balance_section,
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
  v_section_raw text;
  v_class jsonb;
  v_section text;
  v_balance_raw text;
  v_balance_class jsonb;
  v_balance_section text;
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

  if p_data ? 'income_statement_section' then
    v_section_raw := p_data ->> 'income_statement_section';
  else
    v_section_raw := v_row.income_statement_section;
  end if;
  v_class := public.finance_chart_account_classify_income_statement_section(
    v_financial_type, v_account_kind, v_section_raw
  );
  if v_class ->> 'error' is not null then
    raise exception '%', v_class ->> 'error';
  end if;
  v_section := v_class ->> 'section';

  if p_data ? 'balance_sheet_section' then
    v_balance_raw := p_data ->> 'balance_sheet_section';
  else
    v_balance_raw := v_row.balance_sheet_section;
  end if;
  v_balance_class := public.finance_chart_account_classify_balance_sheet_section(
    v_financial_type, v_account_kind, v_balance_raw
  );
  if v_balance_class ->> 'error' is not null then
    raise exception '%', v_balance_class ->> 'error';
  end if;
  v_balance_section := v_balance_class ->> 'section';

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
    income_statement_section = v_section,
    balance_sheet_section = v_balance_section,
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
  v_warnings jsonb := '[]'::jsonb;
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
  v_class jsonb;
  v_balance_class jsonb;
  v_bs_raw text;
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

    if v_financial_type in ('asset', 'liability', 'equity', 'income', 'cost', 'expense')
      and v_account_kind in ('header', 'detail') then
      v_class := public.finance_chart_account_classify_income_statement_section(
        v_financial_type, v_account_kind, v_row ->> 'seccion_resultados'
      );
      if v_class ->> 'error' is not null then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object(
          'row_number', v_idx, 'field', 'seccion_resultados', 'message', v_class ->> 'error'
        ));
      elsif v_class ->> 'warning' is not null then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'row_number', v_idx, 'field', 'seccion_resultados', 'message', v_class ->> 'warning'
        ));
      end if;
      v_bs_raw := case
        when v_row ? 'seccion_balance' then v_row ->> 'seccion_balance'
        when v_row ? 'balance_sheet_section' then v_row ->> 'balance_sheet_section'
        else null
      end;
      v_balance_class := public.finance_chart_account_classify_balance_sheet_section(
        v_financial_type, v_account_kind, v_bs_raw
      );
      if v_balance_class ->> 'error' is not null then
        v_row_errors := v_row_errors || jsonb_build_array(jsonb_build_object(
          'row_number', v_idx, 'field', 'seccion_balance', 'message', v_balance_class ->> 'error'
        ));
      elsif v_balance_class ->> 'warning' is not null then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'row_number', v_idx, 'field', 'seccion_balance', 'message', v_balance_class ->> 'warning'
        ));
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
    'errors', v_errors,
    'warnings', v_warnings,
    'warning_rows', (
      select count(distinct (warn ->> 'row_number')::int)
      from jsonb_array_elements(v_warnings) warn
    )
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
  v_account_kind text;
  v_id_map jsonb := '{}'::jsonb;
  v_inserted int := 0;
  v_sorted jsonb;
  v_class jsonb;
  v_section text;
  v_balance_class jsonb;
  v_balance_section text;
  v_bs_raw text;
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
    v_account_kind := lower(trim(v_row ->> 'tipo_cuenta'));
    v_parent_id := null;

    v_class := public.finance_chart_account_classify_income_statement_section(
      v_financial_type, v_account_kind, v_row ->> 'seccion_resultados'
    );
    if v_class ->> 'error' is not null then
      raise exception '%', v_class ->> 'error';
    end if;
    v_section := v_class ->> 'section';

    v_bs_raw := case
      when v_row ? 'seccion_balance' then v_row ->> 'seccion_balance'
      when v_row ? 'balance_sheet_section' then v_row ->> 'balance_sheet_section'
      else null
    end;
    v_balance_class := public.finance_chart_account_classify_balance_sheet_section(
      v_financial_type, v_account_kind, v_bs_raw
    );
    if v_balance_class ->> 'error' is not null then
      raise exception '%', v_balance_class ->> 'error';
    end if;
    v_balance_section := v_balance_class ->> 'section';

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
      income_statement_section,
      balance_sheet_section,
      created_by, updated_by
    )
    values (
      v_code,
      trim(v_row ->> 'nombre'),
      v_parent_id,
      public.finance_chart_account_parent_level(v_parent_id) + 1,
      v_financial_type,
      lower(trim(v_row ->> 'naturaleza')),
      v_account_kind,
      case
        when v_account_kind = 'header' then false
        else lower(trim(coalesce(v_row ->> 'acepta_movimientos', ''))) in ('true', '1', 'si', 'sí', 'yes')
      end,
      coalesce(nullif(trim(v_row ->> 'descripcion'), ''), ''),
      public.finance_chart_account_default_branch_dimension_rule(v_financial_type),
      public.finance_chart_account_default_cost_center_dimension_rule(v_financial_type),
      v_section,
      v_balance_section,
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


create or replace function public.get_finance_balance_sheet(
  p_cutoff_date date,
  p_branch_id uuid default null,
  p_cost_center_id uuid default null,
  p_include_zero_accounts boolean default false,
  p_snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_include_zero boolean := coalesce(p_include_zero_accounts, false);
  v_snapshot_at timestamptz := coalesce(p_snapshot_at, now());
  v_branch_scope uuid[];
  v_current_assets numeric(18, 2);
  v_noncurrent_assets numeric(18, 2);
  v_current_liabilities numeric(18, 2);
  v_noncurrent_liabilities numeric(18, 2);
  v_registered_equity numeric(18, 2);
  v_classified_assets numeric(18, 2);
  v_classified_liabilities numeric(18, 2);
  v_classified_equity numeric(18, 2);
  v_classified_total_equity numeric(18, 2);
  v_classified_liabilities_and_equity numeric(18, 2);
  v_classified_difference numeric(18, 2);
  v_unclassified_assets numeric(18, 2);
  v_unclassified_liabilities numeric(18, 2);
  v_unclassified_equity numeric(18, 2);
  v_unclassified_debit numeric(18, 2);
  v_unclassified_credit numeric(18, 2);
  v_unclassified_count bigint;
  v_accumulated numeric(18, 2);
  v_accumulated_debit numeric(18, 2);
  v_accumulated_credit numeric(18, 2);
  v_accumulated_count bigint;
  v_document_count bigint;
  v_control_assets numeric(18, 2);
  v_control_liabilities numeric(18, 2);
  v_control_registered_equity numeric(18, 2);
  v_control_equity numeric(18, 2);
  v_control_liabilities_and_equity numeric(18, 2);
  v_difference numeric(18, 2);
  v_complete boolean;
  v_square boolean;
  v_sections jsonb;
  v_unclassified jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado.';
  end if;
  if not public.can_view_accounting() then
    raise exception 'No tienes permiso para consultar reportes contables.';
  end if;
  if p_cutoff_date is null then
    raise exception 'La fecha de corte es obligatoria.';
  end if;

  v_branch_scope := public.accounting_journal_branch_scope();

  with lines as (
    select jl.account_id, jl.debit, jl.credit
    from public.finance_journal_entries je
    inner join public.finance_journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
      and je.posted_at is not null
      and je.posted_at <= v_snapshot_at
      and je.entry_date <= p_cutoff_date
      and (p_branch_id is null or jl.branch_id = p_branch_id)
      and (p_cost_center_id is null or jl.cost_center_id = p_cost_center_id)
      and (
        v_branch_scope is null
        or jl.branch_id is null
        or jl.branch_id = any (v_branch_scope)
      )
  ),
  agg as (
    select
      l.account_id,
      coalesce(sum(l.debit), 0)::numeric(18, 2) as debit,
      coalesce(sum(l.credit), 0)::numeric(18, 2) as credit,
      count(*)::bigint as movement_count
    from lines l
    group by l.account_id
  ),
  base as (
    select
      a.id as account_id,
      a.code,
      a.name,
      a.financial_type,
      a.natural_balance,
      a.balance_sheet_section,
      a.is_active,
      parent.code as parent_code,
      coalesce(g.debit, 0)::numeric(18, 2) as debit,
      coalesce(g.credit, 0)::numeric(18, 2) as credit,
      coalesce(g.movement_count, 0)::bigint as movement_count,
      (
        case
          when a.natural_balance = 'credit'
            then coalesce(g.credit, 0) - coalesce(g.debit, 0)
          else coalesce(g.debit, 0) - coalesce(g.credit, 0)
        end
      )::numeric(18, 2) as natural_signed,
      (
        case
          when a.financial_type = 'asset'
            then coalesce(g.debit, 0) - coalesce(g.credit, 0)
          else coalesce(g.credit, 0) - coalesce(g.debit, 0)
        end
      )::numeric(18, 2) as amount
    from public.finance_chart_accounts a
    left join public.finance_chart_accounts parent on parent.id = a.parent_id
    left join agg g on g.account_id = a.id
    where a.account_kind = 'detail'
  ),
  classified as (
    select * from base
    where balance_sheet_section is not null
      and financial_type in ('asset', 'liability', 'equity')
  ),
  visible as (
    select * from classified
    where v_include_zero or abs(amount) >= 0.005
  ),
  unclassified as (
    select * from base
    where balance_sheet_section is null
      and financial_type in ('asset', 'liability', 'equity')
      and abs(amount) >= 0.005
  ),
  pnl as (
    select * from base
    where financial_type in ('income', 'cost', 'expense')
  )
  select
    coalesce((select sum(amount) from classified where balance_sheet_section = 'current_asset'), 0),
    coalesce((select sum(amount) from classified where balance_sheet_section = 'noncurrent_asset'), 0),
    coalesce((select sum(amount) from classified where balance_sheet_section = 'current_liability'), 0),
    coalesce((select sum(amount) from classified where balance_sheet_section = 'noncurrent_liability'), 0),
    coalesce((select sum(amount) from classified where balance_sheet_section = 'equity'), 0),
    coalesce((select sum(amount) from unclassified where financial_type = 'asset'), 0),
    coalesce((select sum(amount) from unclassified where financial_type = 'liability'), 0),
    coalesce((select sum(amount) from unclassified where financial_type = 'equity'), 0),
    coalesce((select sum(debit) from unclassified), 0),
    coalesce((select sum(credit) from unclassified), 0),
    (select count(*) from unclassified),
    coalesce((select sum(amount) from pnl), 0),
    coalesce((select sum(debit) from pnl), 0),
    coalesce((select sum(credit) from pnl), 0),
    (select count(*) from pnl where abs(amount) >= 0.005),
    (select count(*) from visible) + (select count(*) from unclassified),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', d.key,
        'label', d.label,
        'subtotal', coalesce((select sum(c.amount) from classified c where c.balance_sheet_section = d.key), 0),
        'accounts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'account_id', v.account_id,
            'code', v.code,
            'name', v.name,
            'financial_type', v.financial_type,
            'natural_balance', v.natural_balance,
            'balance_sheet_section', v.balance_sheet_section,
            'is_active', v.is_active,
            'parent_code', v.parent_code,
            'debit', v.debit,
            'credit', v.credit,
            'amount', v.amount,
            'natural_signed', v.natural_signed,
            'contrary', v.natural_signed < -0.004,
            'movement_count', v.movement_count
          ) order by v.code)
          from visible v
          where v.balance_sheet_section = d.key
        ), '[]'::jsonb)
      ) order by d.ord)
      from (
        values
          (1, 'current_asset', 'Activo corriente'),
          (2, 'noncurrent_asset', 'Activo no corriente'),
          (3, 'current_liability', 'Pasivo corriente'),
          (4, 'noncurrent_liability', 'Pasivo no corriente'),
          (5, 'equity', 'Patrimonio')
      ) as d(ord, key, label)
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', u.account_id,
        'code', u.code,
        'name', u.name,
        'financial_type', u.financial_type,
        'natural_balance', u.natural_balance,
        'balance_sheet_section', u.balance_sheet_section,
        'is_active', u.is_active,
        'parent_code', u.parent_code,
        'debit', u.debit,
        'credit', u.credit,
        'amount', u.amount,
        'natural_signed', u.natural_signed,
        'contrary', u.natural_signed < -0.004,
        'movement_count', u.movement_count
      ) order by u.code)
      from unclassified u
    ), '[]'::jsonb)
  into
    v_current_assets, v_noncurrent_assets, v_current_liabilities, v_noncurrent_liabilities, v_registered_equity,
    v_unclassified_assets, v_unclassified_liabilities, v_unclassified_equity,
    v_unclassified_debit, v_unclassified_credit, v_unclassified_count,
    v_accumulated, v_accumulated_debit, v_accumulated_credit, v_accumulated_count,
    v_document_count, v_sections, v_unclassified
  from (select 1) as anchor;

  if v_document_count > 2000 then
    raise exception 'El Balance General supera el límite de 2000 cuentas.';
  end if;

  v_classified_assets := (v_current_assets + v_noncurrent_assets)::numeric(18, 2);
  v_classified_liabilities := (v_current_liabilities + v_noncurrent_liabilities)::numeric(18, 2);
  v_classified_equity := v_registered_equity;
  v_classified_total_equity := (v_classified_equity + v_accumulated)::numeric(18, 2);
  v_classified_liabilities_and_equity := (v_classified_liabilities + v_classified_total_equity)::numeric(18, 2);
  v_classified_difference := (v_classified_assets - v_classified_liabilities_and_equity)::numeric(18, 2);
  v_control_assets := (v_classified_assets + v_unclassified_assets)::numeric(18, 2);
  v_control_liabilities := (v_classified_liabilities + v_unclassified_liabilities)::numeric(18, 2);
  v_control_registered_equity := (v_classified_equity + v_unclassified_equity)::numeric(18, 2);
  v_control_equity := (v_control_registered_equity + v_accumulated)::numeric(18, 2);
  v_control_liabilities_and_equity := (v_control_liabilities + v_control_equity)::numeric(18, 2);
  v_difference := (v_control_assets - v_control_liabilities_and_equity)::numeric(18, 2);
  v_complete := v_unclassified_count = 0;
  v_square := abs(v_difference) < 0.005;

  if not v_complete then
    v_warnings := v_warnings || jsonb_build_array(
      'Hay cuentas de balance con saldo y sin sección. El reporte no es definitivo.'
    );
  end if;
  if p_branch_id is not null or p_cost_center_id is not null then
    v_warnings := v_warnings || jsonb_build_array(
      'El filtro de sucursal o centro de costo puede descuadrar el balance porque excluye líneas de contrapartida.'
    );
  end if;

  return jsonb_build_object(
    'cutoff_date', p_cutoff_date,
    'snapshot_at', v_snapshot_at,
    'scope', case
      when p_branch_id is not null and p_cost_center_id is not null then 'branch_and_cost_center'
      when p_branch_id is not null then 'branch'
      when p_cost_center_id is not null then 'cost_center'
      else 'global'
    end,
    'branch_id', p_branch_id,
    'cost_center_id', p_cost_center_id,
    'include_zero_accounts', v_include_zero,
    'dimensional_filter', p_branch_id is not null or p_cost_center_id is not null,
    'report_complete', v_complete,
    'report_label', case when v_complete then 'Balance General' else 'Balance provisional' end,
    'balance_status', case when v_square then 'Cuadrado' else 'Descuadrado' end,
    'is_square', v_square,
    'current_assets_total', v_current_assets,
    'noncurrent_assets_total', v_noncurrent_assets,
    'classified_total_assets', v_classified_assets,
    'current_liabilities_total', v_current_liabilities,
    'noncurrent_liabilities_total', v_noncurrent_liabilities,
    'classified_total_liabilities', v_classified_liabilities,
    'classified_registered_equity', v_classified_equity,
    'accumulated_result', v_accumulated,
    'classified_total_equity', v_classified_total_equity,
    'classified_total_liabilities_and_equity', v_classified_liabilities_and_equity,
    'classified_difference', v_classified_difference,
    'unclassified_asset_amount', v_unclassified_assets,
    'unclassified_liability_amount', v_unclassified_liabilities,
    'unclassified_equity_amount', v_unclassified_equity,
    'control_total_assets', v_control_assets,
    'control_total_liabilities', v_control_liabilities,
    'control_registered_equity', v_control_registered_equity,
    'control_total_equity', v_control_equity,
    'control_total_liabilities_and_equity', v_control_liabilities_and_equity,
    'difference', v_difference,
    'accumulated_result_detail', jsonb_build_object(
      'amount', v_accumulated,
      'debit', v_accumulated_debit,
      'credit', v_accumulated_credit,
      'account_count', v_accumulated_count
    ),
    'unclassified_debit', v_unclassified_debit,
    'unclassified_credit', v_unclassified_credit,
    'unclassified_account_count', v_unclassified_count,
    'account_count', v_document_count,
    'warnings', v_warnings,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'unclassified_accounts', coalesce(v_unclassified, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.finance_chart_account_classify_balance_sheet_section(text, text, text)
  from public, anon, authenticated, service_role;

revoke all on function public.get_finance_balance_sheet(date, uuid, uuid, boolean, timestamptz)
  from public, anon, service_role;
grant execute on function public.get_finance_balance_sheet(date, uuid, uuid, boolean, timestamptz)
  to authenticated;
