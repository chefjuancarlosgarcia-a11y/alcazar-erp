-- Finance accounting foundation — chart of accounts (Phase 1)
-- Apply after 130_finance_phase2_integrations.sql
-- Number 202: FELplex worktree reserves 201 for pos_fel_documents.
--
-- Adds hierarchical account catalog importable via CSV. No journal entries in this phase.

-- ---------------------------------------------------------------------------
-- Role catalog fix: contador referenced in finance RLS but missing from user_roles
-- ---------------------------------------------------------------------------

insert into public.user_roles (role_key, role_name, description, category, is_system, is_active)
values (
  'contador',
  'Contador',
  'Contabilidad y finanzas formales',
  'Administración',
  true,
  true
)
on conflict (role_key) do update
set role_name = excluded.role_name,
    description = excluded.description,
    category = excluded.category,
    is_system = true,
    is_active = true,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_accounting_catalog()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in ('admin', 'contador')
  );
$$;

revoke all on function public.can_manage_accounting_catalog() from public;
grant execute on function public.can_manage_accounting_catalog() to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.finance_chart_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  parent_id uuid references public.finance_chart_accounts(id) on delete restrict,
  level smallint not null check (level >= 1 and level <= 32),
  financial_type text not null
    check (financial_type in ('asset', 'liability', 'equity', 'income', 'cost', 'expense')),
  natural_balance text not null
    check (natural_balance in ('debit', 'credit')),
  account_kind text not null
    check (account_kind in ('header', 'detail')),
  accepts_entries boolean not null,
  is_active boolean not null default true,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint finance_chart_accounts_header_no_entries
    check (account_kind <> 'header' or accepts_entries = false)
);

create unique index if not exists finance_chart_accounts_code_unique_idx
  on public.finance_chart_accounts (code);

create index if not exists finance_chart_accounts_parent_idx
  on public.finance_chart_accounts (parent_id);

create index if not exists finance_chart_accounts_active_idx
  on public.finance_chart_accounts (is_active, code);

create index if not exists finance_chart_accounts_type_idx
  on public.finance_chart_accounts (financial_type, account_kind);

create index if not exists finance_chart_accounts_search_idx
  on public.finance_chart_accounts using gin (to_tsvector('simple', coalesce(code, '') || ' ' || coalesce(name, '')));

drop trigger if exists finance_chart_accounts_updated_at on public.finance_chart_accounts;
create trigger finance_chart_accounts_updated_at
  before update on public.finance_chart_accounts
  for each row execute function public.finance_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.finance_chart_accounts enable row level security;

grant select on public.finance_chart_accounts to authenticated;
grant insert, update on public.finance_chart_accounts to authenticated;
grant all on public.finance_chart_accounts to service_role;

drop policy if exists finance_chart_accounts_select on public.finance_chart_accounts;
create policy finance_chart_accounts_select on public.finance_chart_accounts
  for select to authenticated
  using (public.can_view_finance());

drop policy if exists finance_chart_accounts_insert on public.finance_chart_accounts;
create policy finance_chart_accounts_insert on public.finance_chart_accounts
  for insert to authenticated
  with check (public.can_manage_accounting_catalog());

drop policy if exists finance_chart_accounts_update on public.finance_chart_accounts;
create policy finance_chart_accounts_update on public.finance_chart_accounts
  for update to authenticated
  using (public.can_manage_accounting_catalog())
  with check (public.can_manage_accounting_catalog());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.finance_chart_account_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(coalesce(p_code, '')), '');
$$;

create or replace function public.finance_chart_account_parent_level(p_parent_id uuid)
returns smallint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level smallint;
begin
  if p_parent_id is null then
    return 0;
  end if;
  select level into v_level from public.finance_chart_accounts where id = p_parent_id;
  if not found then
    raise exception 'La cuenta padre no existe.';
  end if;
  return v_level;
end;
$$;

create or replace function public.finance_chart_account_assert_no_cycle(p_id uuid, p_parent_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current uuid := p_parent_id;
begin
  if p_parent_id is null then
    return;
  end if;
  if p_id is not null and p_parent_id = p_id then
    raise exception 'Una cuenta no puede ser su propio padre.';
  end if;
  while v_current is not null loop
    if p_id is not null and v_current = p_id then
      raise exception 'La jerarquía genera un ciclo inválido.';
    end if;
    select parent_id into v_current from public.finance_chart_accounts where id = v_current;
  end loop;
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
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'created_by', p_row.created_by,
    'updated_by', p_row.updated_by,
    'has_children', exists (
      select 1 from public.finance_chart_accounts child where child.parent_id = p_row.id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- List / CRUD RPCs
-- ---------------------------------------------------------------------------

create or replace function public.list_finance_chart_accounts(
  p_search text default null,
  p_financial_type text default null,
  p_natural_balance text default null,
  p_account_kind text default null,
  p_is_active boolean default null,
  p_include_inactive boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_finance() then
    raise exception 'No tienes permiso para ver el catálogo contable.';
  end if;

  return coalesce((
    select jsonb_agg(public.finance_chart_account_row_to_json(a) order by a.code)
    from public.finance_chart_accounts a
    where (p_include_inactive or a.is_active)
      and (p_is_active is null or a.is_active = p_is_active)
      and (p_financial_type is null or a.financial_type = p_financial_type)
      and (p_natural_balance is null or a.natural_balance = p_natural_balance)
      and (p_account_kind is null or a.account_kind = p_account_kind)
      and (
        p_search is null
        or trim(p_search) = ''
        or a.code ilike '%' || trim(p_search) || '%'
        or a.name ilike '%' || trim(p_search) || '%'
      )
  ), '[]'::jsonb);
end;
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

  insert into public.finance_chart_accounts (
    code, name, parent_id, level, financial_type, natural_balance,
    account_kind, accepts_entries, description, created_by, updated_by
  )
  values (
    v_code, v_name, v_parent_id, v_level, v_financial_type, v_natural_balance,
    v_account_kind, v_accepts_entries, v_description, auth.uid(), auth.uid()
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

  if v_has_children then
    if v_account_kind <> 'header' then
      raise exception 'Las cuentas con subcuentas deben permanecer como acumuladoras (header).';
    end if;
    v_accepts_entries := false;
  elsif v_account_kind = 'header' then
    v_accepts_entries := false;
  end if;

  update public.finance_chart_accounts
  set
    name = coalesce(nullif(trim(p_data ->> 'name'), ''), name),
    parent_id = v_parent_id,
    level = public.finance_chart_account_parent_level(v_parent_id) + 1,
    financial_type = coalesce(lower(trim(p_data ->> 'financial_type')), financial_type),
    natural_balance = coalesce(lower(trim(p_data ->> 'natural_balance')), natural_balance),
    account_kind = v_account_kind,
    accepts_entries = v_accepts_entries,
    description = coalesce(nullif(trim(p_data ->> 'description'), ''), description),
    updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

create or replace function public.set_finance_chart_account_active(p_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_chart_accounts;
begin
  if not public.can_manage_accounting_catalog() then
    raise exception 'No tienes permiso para administrar el catálogo contable.';
  end if;

  update public.finance_chart_accounts
  set is_active = coalesce(p_is_active, true),
      updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  if not found then raise exception 'Cuenta contable no encontrada.'; end if;
  return public.finance_chart_account_row_to_json(v_row);
end;
$$;

-- ---------------------------------------------------------------------------
-- Import validation + atomic import
-- ---------------------------------------------------------------------------

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

create or replace function public.finance_chart_import_would_cycle(
  p_code text,
  p_parent_code text,
  p_rows jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_current text := p_parent_code;
  v_guard int := 0;
  v_parent_of text;
begin
  while v_current is not null and v_guard < 64 loop
    v_guard := v_guard + 1;
    if v_current = p_code then
      return true;
    end if;
    select public.finance_chart_account_normalize_code(elem ->> 'codigo_padre')
    into v_parent_of
    from jsonb_array_elements(p_rows) elem
    where public.finance_chart_account_normalize_code(elem ->> 'codigo') = v_current
    limit 1;
    if v_parent_of is null then
      exit;
    end if;
    v_current := v_parent_of;
  end loop;
  return false;
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
      account_kind, accepts_entries, description, created_by, updated_by
    )
    values (
      v_code,
      trim(v_row ->> 'nombre'),
      v_parent_id,
      public.finance_chart_account_parent_level(v_parent_id) + 1,
      lower(trim(v_row ->> 'tipo_financiero')),
      lower(trim(v_row ->> 'naturaleza')),
      lower(trim(v_row ->> 'tipo_cuenta')),
      case
        when lower(trim(v_row ->> 'tipo_cuenta')) = 'header' then false
        else lower(trim(coalesce(v_row ->> 'acepta_movimientos', ''))) in ('true', '1', 'si', 'sí', 'yes')
      end,
      coalesce(nullif(trim(v_row ->> 'descripcion'), ''), ''),
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

create or replace function public.finance_chart_import_sort_rows(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_remaining jsonb;
  v_row jsonb;
  v_code text;
  v_parent_code text;
  v_ready boolean;
  v_added text[] := '{}';
  v_guard int := 0;
  v_parent_ready boolean;
begin
  v_remaining := p_rows;
  while jsonb_array_length(v_remaining) > 0 and v_guard < 10000 loop
    v_guard := v_guard + 1;
    v_ready := false;
    for v_row in select value from jsonb_array_elements(v_remaining) loop
      v_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo');
      v_parent_code := public.finance_chart_account_normalize_code(v_row ->> 'codigo_padre');
      v_parent_ready := v_parent_code is null
        or v_parent_code = any(v_added)
        or exists(select 1 from public.finance_chart_accounts where code = v_parent_code);
      if v_parent_ready then
        v_result := v_result || jsonb_build_array(v_row);
        v_added := array_append(v_added, v_code);
        v_remaining := (
          select coalesce(jsonb_agg(elem), '[]'::jsonb)
          from jsonb_array_elements(v_remaining) elem
          where public.finance_chart_account_normalize_code(elem ->> 'codigo') <> v_code
        );
        v_ready := true;
        exit;
      end if;
    end loop;
    if not v_ready then
      raise exception 'No se pudo ordenar la jerarquía del archivo. Revise las cuentas padre.';
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) from public;
revoke all on function public.create_finance_chart_account(jsonb) from public;
revoke all on function public.update_finance_chart_account(uuid, jsonb) from public;
revoke all on function public.set_finance_chart_account_active(uuid, boolean) from public;
revoke all on function public.preview_finance_chart_accounts_import(jsonb) from public;
revoke all on function public.import_finance_chart_accounts(jsonb) from public;
revoke all on function public.finance_chart_account_normalize_code(text) from public;
revoke all on function public.finance_chart_account_parent_level(uuid) from public;
revoke all on function public.finance_chart_account_assert_no_cycle(uuid, uuid) from public;
revoke all on function public.finance_chart_account_row_to_json(public.finance_chart_accounts) from public;
revoke all on function public.finance_chart_import_would_cycle(text, text, jsonb) from public;
revoke all on function public.finance_chart_import_sort_rows(jsonb) from public;

grant execute on function public.list_finance_chart_accounts(text, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.create_finance_chart_account(jsonb) to authenticated;
grant execute on function public.update_finance_chart_account(uuid, jsonb) to authenticated;
grant execute on function public.set_finance_chart_account_active(uuid, boolean) to authenticated;
grant execute on function public.preview_finance_chart_accounts_import(jsonb) to authenticated;
grant execute on function public.import_finance_chart_accounts(jsonb) to authenticated;
