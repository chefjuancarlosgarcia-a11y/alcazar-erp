-- Estado de Resultados.
-- Apply after 216_finance_trial_balance.sql.
-- Adds income_statement_section (nullable, no backfill) and
-- get_finance_income_statement. Replaces catalog RPCs in place.
-- Does not edit migrations 202–216 and does not write schema_migrations.

alter table public.finance_chart_accounts
  add column if not exists income_statement_section text;

alter table public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_income_statement_section_check;

alter table public.finance_chart_accounts
  add constraint finance_chart_accounts_income_statement_section_check
  check (
    income_statement_section is null
    or (
      account_kind = 'detail'
      and (
        (
          financial_type = 'income'
          and income_statement_section in ('operating_income', 'sales_contra', 'other_income')
        )
        or (
          financial_type = 'cost'
          and income_statement_section = 'cost_of_sales'
        )
        or (
          financial_type = 'expense'
          and income_statement_section in (
            'operating_expense_selling',
            'operating_expense_admin',
            'operating_expense_other',
            'other_expense',
            'income_tax'
          )
        )
      )
    )
  );

comment on column public.finance_chart_accounts.income_statement_section is
  'Sección explícita del Estado de Resultados. Nula hasta que el contador la asigne. No se deduce del código, nombre, padre ni naturaleza.';

create or replace function public.finance_chart_account_classify_income_statement_section(
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
  v_warning text := 'La cuenta podrá recibir movimientos, pero el Estado de Resultados permanecerá incompleto hasta clasificarla.';
begin
  if v_raw is null then
    if v_kind = 'detail' and v_type in ('income', 'cost', 'expense') then
      return jsonb_build_object('section', null, 'error', null, 'warning', v_warning);
    end if;
    return jsonb_build_object('section', null, 'error', null, 'warning', null);
  end if;

  v_section := case v_raw
    when 'operating_income' then 'operating_income'
    when 'ingresos operativos' then 'operating_income'
    when 'sales_contra' then 'sales_contra'
    when 'devoluciones y descuentos sobre ventas' then 'sales_contra'
    when 'cost_of_sales' then 'cost_of_sales'
    when 'costo de ventas' then 'cost_of_sales'
    when 'operating_expense_selling' then 'operating_expense_selling'
    when 'gastos de venta' then 'operating_expense_selling'
    when 'operating_expense_admin' then 'operating_expense_admin'
    when 'gastos administrativos' then 'operating_expense_admin'
    when 'operating_expense_other' then 'operating_expense_other'
    when 'otros gastos operativos' then 'operating_expense_other'
    when 'other_income' then 'other_income'
    when 'otros ingresos' then 'other_income'
    when 'other_expense' then 'other_expense'
    when 'otros gastos' then 'other_expense'
    when 'income_tax' then 'income_tax'
    when 'impuesto sobre la renta' then 'income_tax'
    else null
  end;

  if v_section is null then
    return jsonb_build_object('section', null, 'error', 'Sección del Estado de Resultados desconocida.', 'warning', null);
  end if;
  if v_kind = 'header' then
    return jsonb_build_object('section', null, 'error', 'Las cuentas acumuladoras no llevan sección del Estado de Resultados.', 'warning', null);
  end if;
  if v_type in ('asset', 'liability', 'equity') then
    return jsonb_build_object('section', null, 'error', 'Las cuentas de balance no llevan sección del Estado de Resultados.', 'warning', null);
  end if;
  if not (
    (v_type = 'income' and v_section in ('operating_income', 'sales_contra', 'other_income'))
    or (v_type = 'cost' and v_section = 'cost_of_sales')
    or (v_type = 'expense' and v_section in (
      'operating_expense_selling', 'operating_expense_admin', 'operating_expense_other', 'other_expense', 'income_tax'
    ))
  ) then
    return jsonb_build_object('section', null, 'error', 'La sección del Estado de Resultados no corresponde al tipo financiero.', 'warning', null);
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
    created_by, updated_by
  )
  values (
    v_code, v_name, v_parent_id, v_level, v_financial_type, v_natural_balance,
    v_account_kind, v_accepts_entries, v_description,
    v_branch_rule, v_cost_center_rule,
    v_section,
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

create or replace function public.get_finance_income_statement(
  p_from_date date default null,
  p_to_date date default null,
  p_period_id uuid default null,
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
  v_period_start date;
  v_period_end date;
  v_effective_from date;
  v_effective_to date;
  v_branch_scope uuid[];
  v_operating_income numeric(18, 2);
  v_sales_contra numeric(18, 2);
  v_cost_of_sales numeric(18, 2);
  v_selling numeric(18, 2);
  v_admin numeric(18, 2);
  v_other_operating numeric(18, 2);
  v_other_income numeric(18, 2);
  v_other_expense numeric(18, 2);
  v_income_tax numeric(18, 2);
  v_unclassified_debit numeric(18, 2);
  v_unclassified_credit numeric(18, 2);
  v_unclassified_count bigint;
  v_document_count bigint;
  v_tax_classified boolean;
  v_complete boolean;
  v_net_revenue numeric(18, 2);
  v_gross_profit numeric(18, 2);
  v_operating_expenses numeric(18, 2);
  v_operating_profit numeric(18, 2);
  v_other_result numeric(18, 2);
  v_profit_before_tax numeric(18, 2);
  v_classified_net numeric(18, 2);
  v_sections jsonb;
  v_unclassified jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado.';
  end if;
  if not public.can_view_accounting() then
    raise exception 'No tienes permiso para consultar reportes contables.';
  end if;
  if p_from_date is not null and p_to_date is not null and p_from_date > p_to_date then
    raise exception 'La fecha desde no puede ser posterior a la fecha hasta.';
  end if;

  if p_period_id is not null then
    select start_date, end_date into v_period_start, v_period_end
    from public.finance_accounting_periods
    where id = p_period_id;
    if not found then
      raise exception 'El periodo contable no existe.';
    end if;
    v_effective_from := v_period_start;
    v_effective_to := v_period_end;
    if p_from_date is not null and p_from_date > v_effective_from then
      v_effective_from := p_from_date;
    end if;
    if p_to_date is not null and p_to_date < v_effective_to then
      v_effective_to := p_to_date;
    end if;
    if v_effective_from > v_effective_to then
      raise exception 'El periodo contable y el rango de fechas no se intersectan.';
    end if;
  else
    v_effective_from := p_from_date;
    v_effective_to := p_to_date;
  end if;

  v_branch_scope := public.accounting_journal_branch_scope();

  with lines as (
    select jl.account_id, jl.debit, jl.credit
    from public.finance_journal_entries je
    inner join public.finance_journal_lines jl on jl.journal_entry_id = je.id
    where je.status = 'posted'
      and je.posted_at is not null
      and je.posted_at <= v_snapshot_at
      and (v_effective_from is null or je.entry_date >= v_effective_from)
      and (v_effective_to is null or je.entry_date <= v_effective_to)
      and (p_period_id is null or je.period_id = p_period_id)
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
      coalesce(sum(l.debit), 0)::numeric(18, 2) as period_debit,
      coalesce(sum(l.credit), 0)::numeric(18, 2) as period_credit,
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
      a.income_statement_section,
      a.is_active,
      coalesce(g.period_debit, 0)::numeric(18, 2) as period_debit,
      coalesce(g.period_credit, 0)::numeric(18, 2) as period_credit,
      coalesce(g.movement_count, 0)::bigint as movement_count,
      (
        case
          when a.income_statement_section in ('operating_income', 'other_income')
            then coalesce(g.period_credit, 0) - coalesce(g.period_debit, 0)
          else coalesce(g.period_debit, 0) - coalesce(g.period_credit, 0)
        end
      )::numeric(18, 2) as amount
    from public.finance_chart_accounts a
    left join agg g on g.account_id = a.id
    where a.account_kind = 'detail'
  ),
  classified as (
    select * from base
    where income_statement_section is not null
      and financial_type in ('income', 'cost', 'expense')
  ),
  visible as (
    select * from classified
    where v_include_zero or period_debit >= 0.005 or period_credit >= 0.005
  ),
  unclassified as (
    select * from base
    where income_statement_section is null
      and financial_type in ('income', 'cost', 'expense')
      and (period_debit >= 0.005 or period_credit >= 0.005)
  )
  select
    coalesce(sum(amount) filter (where income_statement_section = 'operating_income'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'sales_contra'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'cost_of_sales'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'operating_expense_selling'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'operating_expense_admin'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'operating_expense_other'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'other_income'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'other_expense'), 0),
    coalesce(sum(amount) filter (where income_statement_section = 'income_tax'), 0),
    (select coalesce(sum(period_debit), 0) from unclassified),
    (select coalesce(sum(period_credit), 0) from unclassified),
    (select count(*) from unclassified),
    (select count(*) from visible) + (select count(*) from unclassified),
    exists (
      select 1 from public.finance_chart_accounts
      where account_kind = 'detail' and income_statement_section = 'income_tax'
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', d.key,
        'label', d.label,
        'subtotal', coalesce((
          select sum(c.amount) from classified c where c.income_statement_section = d.key
        ), 0),
        'accounts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'account_id', v.account_id,
            'code', v.code,
            'name', v.name,
            'financial_type', v.financial_type,
            'natural_balance', v.natural_balance,
            'income_statement_section', v.income_statement_section,
            'is_active', v.is_active,
            'period_debit', v.period_debit,
            'period_credit', v.period_credit,
            'amount', v.amount,
            'contrary', v.amount < -0.004,
            'movement_count', v.movement_count
          ) order by v.code, v.account_id)
          from visible v
          where v.income_statement_section = d.key
        ), '[]'::jsonb)
      ) order by d.ord)
      from (
        values
          (1, 'operating_income', 'Ingresos operativos'),
          (2, 'sales_contra', 'Devoluciones y descuentos sobre ventas'),
          (3, 'cost_of_sales', 'Costo de ventas'),
          (4, 'operating_expense_selling', 'Gastos de venta'),
          (5, 'operating_expense_admin', 'Gastos administrativos'),
          (6, 'operating_expense_other', 'Otros gastos operativos'),
          (7, 'other_income', 'Otros ingresos'),
          (8, 'other_expense', 'Otros gastos'),
          (9, 'income_tax', 'Impuesto sobre la renta')
      ) as d(ord, key, label)
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', u.account_id,
        'code', u.code,
        'name', u.name,
        'financial_type', u.financial_type,
        'natural_balance', u.natural_balance,
        'is_active', u.is_active,
        'period_debit', u.period_debit,
        'period_credit', u.period_credit,
        'movement_count', u.movement_count
      ) order by u.code, u.account_id)
      from unclassified u
    ), '[]'::jsonb)
  into
    v_operating_income, v_sales_contra, v_cost_of_sales, v_selling, v_admin, v_other_operating,
    v_other_income, v_other_expense, v_income_tax,
    v_unclassified_debit, v_unclassified_credit, v_unclassified_count, v_document_count,
    v_tax_classified, v_sections, v_unclassified
  from classified;

  if v_document_count > 2000 then
    raise exception 'El Estado de Resultados supera el límite de 2000 cuentas.';
  end if;

  v_complete := v_unclassified_count = 0;
  v_net_revenue := (v_operating_income - v_sales_contra)::numeric(18, 2);
  v_gross_profit := (v_net_revenue - v_cost_of_sales)::numeric(18, 2);
  v_operating_expenses := (v_selling + v_admin + v_other_operating)::numeric(18, 2);
  v_operating_profit := (v_gross_profit - v_operating_expenses)::numeric(18, 2);
  v_other_result := (v_other_income - v_other_expense)::numeric(18, 2);
  v_profit_before_tax := (v_operating_profit + v_other_result)::numeric(18, 2);
  v_classified_net := (v_profit_before_tax - v_income_tax)::numeric(18, 2);

  if not v_complete then
    v_warnings := v_warnings || jsonb_build_array(
      'Hay cuentas de resultados con movimientos sin sección. El reporte está incompleto.'
    );
  end if;
  if not v_tax_classified then
    v_warnings := v_warnings || jsonb_build_array('Sin cuentas de impuesto clasificadas.');
  end if;

  v_label := case
    when not v_complete then 'Resultado provisional de cuentas clasificadas'
    when v_classified_net < -0.004 then 'Pérdida neta'
    else 'Utilidad neta'
  end;

  return jsonb_build_object(
    'scope', case
      when p_branch_id is not null and p_cost_center_id is not null then 'branch_and_cost_center'
      when p_branch_id is not null then 'branch'
      when p_cost_center_id is not null then 'cost_center'
      else 'global'
    end,
    'effective_from', v_effective_from,
    'effective_to', v_effective_to,
    'include_zero_accounts', v_include_zero,
    'snapshot_at', v_snapshot_at,
    'report_complete', v_complete,
    'income_tax_classified', v_tax_classified,
    'operating_income_total', v_operating_income,
    'sales_contra_total', v_sales_contra,
    'net_revenue', v_net_revenue,
    'cost_of_sales_total', v_cost_of_sales,
    'gross_profit', v_gross_profit,
    'selling_expenses_total', v_selling,
    'administrative_expenses_total', v_admin,
    'other_operating_expenses_total', v_other_operating,
    'operating_expenses_total', v_operating_expenses,
    'operating_profit', v_operating_profit,
    'other_income_total', v_other_income,
    'other_expense_total', v_other_expense,
    'other_result', v_other_result,
    'profit_before_tax', v_profit_before_tax,
    'income_tax_total', v_income_tax,
    'classified_net_result', v_classified_net,
    'net_income', case when v_complete then v_classified_net else null end,
    'net_result_label', v_label,
    'unclassified_debit', v_unclassified_debit,
    'unclassified_credit', v_unclassified_credit,
    'unclassified_net_movement', (v_unclassified_debit - v_unclassified_credit)::numeric(18, 2),
    'unclassified_account_count', v_unclassified_count,
    'account_count', v_document_count,
    'warnings', v_warnings,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'unclassified_accounts', coalesce(v_unclassified, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.finance_chart_account_classify_income_statement_section(text, text, text)
  from public, anon, service_role;
grant execute on function public.finance_chart_account_classify_income_statement_section(text, text, text)
  to authenticated;

revoke all on function public.get_finance_income_statement(date, date, uuid, uuid, uuid, boolean, timestamptz)
  from public, anon, service_role;
grant execute on function public.get_finance_income_statement(date, date, uuid, uuid, uuid, boolean, timestamptz)
  to authenticated;
