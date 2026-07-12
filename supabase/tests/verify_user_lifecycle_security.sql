-- =============================================================================
-- USER LIFECYCLE SECURITY — POST-MIGRATION VERIFICATION (STAGE)
-- =============================================================================
-- Migraciones objetivo:
--   173_profiles_termination_audit.sql
--   174_user_lifecycle_security.sql
--   175_rls_active_profile_guard.sql
--
-- Tipo: diagnóstico / solo lectura (salvo pruebas manuales opcionales documentadas).
-- No ejecutar contra usuarios reales de producción.
-- No incluye service_role, JWT ni secretos.
--
-- Cómo ejecutar (Supabase Stage → SQL Editor):
--   1. Ejecutar secciones 1–10 en orden (todo el archivo o por bloques).
--   2. Revisar columnas "status" = PASS / FAIL / WARN.
--   3. Completar checklist manual en sección 11.
--   4. Pruebas destructivas solo con usuario temporal de Stage (sección 12).
--
-- Rol recomendado en SQL Editor: postgres (o cuenta con acceso a catálogos).
-- Las pruebas de invocación de funciones admin requieren service_role o postgres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECCIÓN 1 — Estructura de public.profiles (migración 173)
-- -----------------------------------------------------------------------------

with expected_columns as (
  select *
  from (values
    ('termination_date',   'timestamp with time zone', 'YES'),
    ('termination_reason', 'text',                     'YES'),
    ('terminated_by',      'uuid',                     'YES'),
    ('reactivated_at',     'timestamp with time zone', 'YES'),
    ('reactivated_by',     'uuid',                     'YES')
  ) as t(column_name, expected_type, expected_nullable)
),
actual_columns as (
  select
    c.column_name,
    c.data_type ||
      case
        when c.data_type = 'timestamp with time zone' then ''
        when c.character_maximum_length is not null
          then '(' || c.character_maximum_length || ')'
        else ''
      end as data_type,
    c.is_nullable
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'profiles'
    and c.column_name in (
      'termination_date', 'termination_reason', 'terminated_by',
      'reactivated_at', 'reactivated_by'
    )
)
select
  e.column_name,
  coalesce(a.data_type, '(missing)') as actual_type,
  e.expected_type,
  coalesce(a.is_nullable, '?') as nullable,
  e.expected_nullable as expected_nullable,
  case
    when a.column_name is null then 'FAIL'
    when a.data_type = e.expected_type and a.is_nullable = e.expected_nullable then 'PASS'
    else 'FAIL'
  end as status
from expected_columns e
left join actual_columns a using (column_name)
order by e.column_name;


-- FK terminated_by / reactivated_by → profiles(id) ON DELETE SET NULL
select
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema || '.' || ccu.table_name as references_table,
  ccu.column_name as references_column,
  rc.delete_rule,
  case
    when rc.delete_rule = 'SET NULL'
     and ccu.table_name = 'profiles'
     and kcu.column_name in ('terminated_by', 'reactivated_by')
      then 'PASS'
    else 'FAIL'
  end as status
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
 and rc.constraint_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'profiles'
  and tc.constraint_type = 'FOREIGN KEY'
  and kcu.column_name in ('terminated_by', 'reactivated_by')
order by kcu.column_name;


-- Índices esperados (migración 173)
with expected_indexes(index_name, index_def_fragment) as (
  values
    ('profiles_status_active_idx',   'where (status = ''active''::text)'),
    ('profiles_terminated_at_idx',   'where (status = ''inactive''::text)'),
    ('profiles_terminated_by_idx',   'where (terminated_by is not null)')
),
actual_indexes as (
  select indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'profiles'
)
select
  e.index_name,
  case when a.indexname is not null then left(a.indexdef, 160) else '(missing)' end as indexdef_preview,
  case
    when a.indexname is null then 'FAIL'
    when a.indexdef ilike '%' || e.index_def_fragment || '%' then 'PASS'
    else 'WARN'
  end as status
from expected_indexes e
left join actual_indexes a on a.indexname = e.index_name
order by e.index_name;


-- -----------------------------------------------------------------------------
-- SECCIÓN 2 — Funciones SQL (migración 174): existencia y metadatos
-- -----------------------------------------------------------------------------

with expected_functions(routine_name, expected_args, expected_returns, expected_secdef) as (
  values
    ('is_current_profile_active',          0, 'boolean', true),
    ('profile_has_operational_history',    1, 'boolean', true),
    ('revoke_user_auth_sessions',          1, 'void',    true)
),
actual_functions as (
  select
    p.proname as routine_name,
    p.pronargs as arg_count,
    pg_get_function_result(p.oid) as returns,
    p.prosecdef as security_definer,
    p.proconfig as config,
    pg_get_userbyid(p.proowner) as owner,
    n.nspname as schema_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'is_current_profile_active',
      'profile_has_operational_history',
      'revoke_user_auth_sessions'
    )
)
select
  e.routine_name,
  coalesce(a.schema_name, '(missing)') as schema_name,
  coalesce(a.arg_count::text, '?') as args,
  e.expected_args::text as expected_args,
  coalesce(a.returns, '(missing)') as returns,
  e.expected_returns as expected_returns,
  coalesce(a.security_definer::text, '?') as security_definer,
  e.expected_secdef::text as expected_secdef,
  case
    when a.config::text ilike '%search_path=%' then 'PASS'
    when a.routine_name is not null then 'FAIL'
    else 'FAIL'
  end as search_path_status,
  coalesce(a.owner, '(missing)') as owner,
  case
    when a.routine_name is null then 'FAIL'
    when a.arg_count = e.expected_args
     and a.returns = e.expected_returns
     and a.security_definer = e.expected_secdef
     and a.config::text ilike '%search_path=%'
      then 'PASS'
    else 'FAIL'
  end as status
from expected_functions e
left join actual_functions a on a.routine_name = e.routine_name
order by e.routine_name;


-- Argumentos detallados
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_current_profile_active',
    'profile_has_operational_history',
    'revoke_user_auth_sessions'
  )
order by p.proname;


-- -----------------------------------------------------------------------------
-- SECCIÓN 3 — Privilegios EXECUTE (no asumir que SECURITY DEFINER basta)
-- -----------------------------------------------------------------------------

with target_functions as (
  select p.oid, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'is_current_profile_active',
      'profile_has_operational_history',
      'revoke_user_auth_sessions'
    )
),
role_checks as (
  select
    tf.proname,
    r.rolname,
    has_function_privilege(r.rolname, tf.oid, 'EXECUTE') as can_execute
  from target_functions tf
  cross join (values ('authenticated'), ('anon'), ('service_role'), ('PUBLIC')) as roles(rolname)
  join pg_roles r on r.rolname = roles.rolname
)
select
  proname as function_name,
  rolname,
  can_execute,
  case proname
    when 'is_current_profile_active' then
      case
        when rolname = 'authenticated' and can_execute then 'PASS'
        when rolname in ('anon', 'PUBLIC') and not can_execute then 'PASS'
        when rolname = 'service_role' and can_execute then 'WARN'
        else 'FAIL'
      end
    when 'profile_has_operational_history' then
      case
        when rolname = 'service_role' and can_execute then 'PASS'
        when rolname in ('authenticated', 'anon', 'PUBLIC') and not can_execute then 'PASS'
        else 'FAIL'
      end
    when 'revoke_user_auth_sessions' then
      case
        when rolname = 'service_role' and can_execute then 'PASS'
        when rolname in ('authenticated', 'anon', 'PUBLIC') and not can_execute then 'PASS'
        else 'FAIL'
      end
    else 'WARN'
  end as status
from role_checks
order by proname, rolname;


-- Resumen de privilegios admin (debe quedar solo service_role)
select
  p.proname as function_name,
  string_agg(
    r.rolname,
    ', ' order by r.rolname
  ) filter (where has_function_privilege(r.rolname, p.oid, 'EXECUTE')) as roles_with_execute,
  case
    when p.proname in ('profile_has_operational_history', 'revoke_user_auth_sessions')
     and bool_and(
       case
         when r.rolname = 'service_role'
          then has_function_privilege(r.rolname, p.oid, 'EXECUTE')
         when r.rolname in ('authenticated', 'anon', 'PUBLIC')
          then not has_function_privilege(r.rolname, p.oid, 'EXECUTE')
         else true
       end
     ) then 'PASS'
    when p.proname = 'is_current_profile_active'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('PUBLIC', p.oid, 'EXECUTE')
      then 'PASS'
    else 'FAIL'
  end as status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles r
where n.nspname = 'public'
  and p.proname in (
    'is_current_profile_active',
    'profile_has_operational_history',
    'revoke_user_auth_sessions'
  )
  and r.rolname in ('authenticated', 'anon', 'service_role', 'PUBLIC')
group by p.proname, p.oid
order by p.proname;


-- -----------------------------------------------------------------------------
-- SECCIÓN 4 — Auditoría estática de revoke_user_auth_sessions (sin ejecutar DELETE)
-- -----------------------------------------------------------------------------

select
  p.proname as function_name,
  left(pg_get_functiondef(p.oid), 1200) as function_definition_preview,
  case
    when pg_get_functiondef(p.oid) ilike '%p_user_id uuid%' then 'PASS' else 'FAIL'
  end as explicit_uuid_arg,
  case
    when pg_get_functiondef(p.oid) ilike '%if p_user_id is null%' then 'PASS' else 'FAIL'
  end as null_guard,
  case
    when pg_get_functiondef(p.oid) ilike '%auth.refresh_tokens%'
     and pg_get_functiondef(p.oid) ilike '%auth.sessions%' then 'PASS'
    else 'FAIL'
  end as explicit_auth_tables,
  case
    when pg_get_functiondef(p.oid) not ilike '%execute %'
     and pg_get_functiondef(p.oid) not ilike '%format(%' then 'PASS'
    else 'WARN'
  end as no_dynamic_sql,
  case
    when p.prosecdef and p.proconfig::text ilike '%search_path=%' then 'PASS' else 'FAIL'
  end as security_definer_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'revoke_user_auth_sessions';


-- Conteo de sesiones/tokens (solo lectura; no borra nada)
-- Útil antes/después de prueba manual con usuario temporal.
select
  'auth.sessions' as object_name,
  count(*)::bigint as row_count,
  'INFO' as status
from auth.sessions
union all
select
  'auth.refresh_tokens',
  count(*)::bigint,
  'INFO'
from auth.refresh_tokens;


-- -----------------------------------------------------------------------------
-- SECCIÓN 5 — Políticas RLS de migración 175
-- -----------------------------------------------------------------------------

with migration_175_policies(policy_name) as (
  values
    ('inventory_items_read_active'),
    ('area_inventory_authenticated_read'),
    ('inventory_movements_authenticated_read'),
    ('inventory_item_barcode_aliases_read'),
    ('inventory_item_merge_audit_read'),
    ('inventory_duplicate_ignore_read'),
    ('inventory_item_unit_conversions_read'),
    ('inventory_unit_conversions_authenticated_read'),
    ('requisitions_authenticated_read'),
    ('requisition_items_authenticated_read'),
    ('pos_orders_authenticated_read'),
    ('pos_order_items_authenticated_read'),
    ('pos_order_events_authenticated_read'),
    ('pos_products_authenticated_read'),
    ('pos_product_variants_authenticated_read'),
    ('pos_product_modifiers_authenticated_read'),
    ('pos_option_groups_authenticated_read'),
    ('pos_option_choices_authenticated_read'),
    ('production_tickets_authenticated_read'),
    ('production_ticket_items_authenticated_read'),
    ('recipes_authenticated_read_active'),
    ('recipe_ingredients_authenticated_read'),
    ('pos_recipe_links_authenticated_read'),
    ('pos_recipe_consumptions_authenticated_read'),
    ('inventory_yield_profiles_read'),
    ('yield_waste_reasons_read'),
    ('yield_audit_campaigns_read'),
    ('yield_audit_campaign_items_read'),
    ('yield_audits_read'),
    ('yield_audits_insert'),
    ('recipe_cost_history_read'),
    ('app_settings_read_authenticated')
),
policy_rows as (
  select
    pol.schemaname,
    pol.tablename,
    pol.policyname,
    pol.cmd,
    pol.roles,
    pol.qual as using_expression,
    pol.with_check as with_check_expression
  from pg_policies pol
  where pol.schemaname = 'public'
)
select
  m.policy_name,
  coalesce(p.tablename, '(missing)') as table_name,
  coalesce(p.cmd, '?') as command,
  coalesce(array_to_string(p.roles, ', '), '?') as roles,
  coalesce(p.using_expression, '(none)') as using_expression,
  coalesce(p.with_check_expression, '(none)') as with_check_expression,
  case
    when p.policyname is null then 'FAIL'
    when coalesce(p.using_expression, '') ilike '%is_current_profile_active()%'
      or coalesce(p.with_check_expression, '') ilike '%is_current_profile_active()%'
      then 'PASS'
    else 'FAIL'
  end as uses_active_guard,
  case
    when p.policyname is null then 'FAIL'
    when coalesce(p.using_expression, '') ilike '%is_current_profile_active()%'
      or coalesce(p.with_check_expression, '') ilike '%is_current_profile_active()%'
      then 'PASS'
    else 'FAIL'
  end as status
from migration_175_policies m
left join policy_rows p on p.policyname = m.policy_name
order by m.policy_name;


-- Políticas SELECT sensibles con USING (true) para rol authenticated
with authenticated_select_policies as (
  select
    pol.schemaname,
    pol.tablename,
    pol.policyname,
    pol.qual as using_expression
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.cmd in ('SELECT', 'ALL')
    and 'authenticated' = any (pol.roles)
),
intentional_exceptions(policyname) as (
  -- Documentadas: no marcar FAIL
  values
    ('profiles_read_own')  -- AuthContext debe leer perfil propio aunque esté inactive
)
select
  asp.schemaname,
  asp.tablename,
  asp.policyname,
  asp.using_expression,
  case
    when ie.policyname is not null then 'PASS'
    when trim(both from asp.using_expression) = 'true' then 'FAIL'
    when asp.using_expression is null then 'WARN'
    else 'PASS'
  end as status,
  case
    when ie.policyname is not null then 'Excepción documentada'
    when trim(both from asp.using_expression) = 'true'
      then 'Lectura abierta a cualquier authenticated — revisar'
    else 'OK'
  end as notes
from authenticated_select_policies asp
left join intentional_exceptions ie on ie.policyname = asp.policyname
where ie.policyname is not null
   or trim(both from coalesce(asp.using_expression, '')) = 'true'
order by asp.tablename, asp.policyname;


-- -----------------------------------------------------------------------------
-- SECCIÓN 6 — Cobertura por módulo (inspección de expresiones reales)
-- -----------------------------------------------------------------------------

with module_expectations(module_name, table_name, policy_name, protection_type) as (
  values
    -- inventario (175: is_current_profile_active)
    ('inventario', 'inventory_items', 'inventory_items_read_active', 'is_current_profile_active'),
    ('inventario', 'area_inventory', 'area_inventory_authenticated_read', 'is_current_profile_active'),
    ('inventario', 'inventory_movements', 'inventory_movements_authenticated_read', 'is_current_profile_active'),
    -- requisiciones (175)
    ('requisiciones', 'requisitions', 'requisitions_authenticated_read', 'is_current_profile_active'),
    ('requisiciones', 'requisition_items', 'requisition_items_authenticated_read', 'is_current_profile_active'),
    -- POS (175)
    ('POS', 'pos_orders', 'pos_orders_authenticated_read', 'is_current_profile_active'),
    ('POS', 'pos_products', 'pos_products_authenticated_read', 'is_current_profile_active'),
    -- KDS (175)
    ('KDS/producción tickets', 'production_tickets', 'production_tickets_authenticated_read', 'is_current_profile_active'),
    -- recetas (175)
    ('recetas', 'standard_recipes', 'recipes_authenticated_read_active', 'is_current_profile_active'),
    -- yield (175)
    ('yield', 'yield_audits', 'yield_audits_read', 'is_current_profile_active'),
    -- configuración (175)
    ('configuración', 'app_settings', 'app_settings_read_authenticated', 'is_current_profile_active'),
    -- caja (helper existente)
    ('caja', 'cash_sessions', 'cash_sessions_operator_read', 'helper:is_cash_operator'),
    ('caja', 'cash_movements', 'cash_movements_operator_read', 'helper:is_cash_operator'),
    -- finanzas (helper existente)
    ('finanzas', 'finance_bank_accounts', 'finance_bank_accounts_select', 'helper:can_view_finance'),
    ('finanzas', 'finance_payables', 'finance_payables_select', 'helper:can_view_finance'),
    -- checklists (helper existente)
    ('checklists', 'checklist_runs', 'checklist_runs_authorized_read', 'helper:can_access_checklist_run'),
    ('checklists', 'checklist_templates', 'checklist_templates_authorized_read', 'helper:can_access_checklists'),
    -- catering (helper existente)
    ('catering', 'catering_requests', 'catering_requests_select', 'helper:can_manage_catering_requests'),
    -- RRHH expedientes (helper existente)
    ('RRHH', 'employee_file_profiles', 'employee_file_profiles_read', 'helper:can_read_employee_expedientes'),
    -- producción interna (helper existente)
    ('producción interna', 'production_batches', 'production_batches_authorized_read', 'helper:can_create_internal_production'),
    -- perfiles propios (intencional)
    ('AuthContext', 'profiles', 'profiles_read_own', 'intencional:perfil_propio')
),
policy_lookup as (
  select policyname, tablename, qual, with_check
  from pg_policies
  where schemaname = 'public'
),
helper_active_checks(helper_name, checks_active_status) as (
  values
    ('is_cash_operator', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_cash_operator')),
    ('can_view_finance', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_view_finance')),
    ('can_access_checklists', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_access_checklists')),
    ('can_access_checklist_run', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_access_checklist_run')),
    ('can_manage_catering_requests', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_manage_catering_requests')),
    ('can_read_employee_expedientes', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_employee_expedientes')),
    ('can_create_internal_production', (select pg_get_functiondef(p.oid) ilike '%status = ''active''%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_create_internal_production'))
)
select
  me.module_name,
  me.table_name,
  me.policy_name,
  me.protection_type,
  case
    when pl.policyname is null then 'pendiente de revisión'
    when me.protection_type = 'is_current_profile_active'
     and (coalesce(pl.qual, '') ilike '%is_current_profile_active()%'
       or coalesce(pl.with_check, '') ilike '%is_current_profile_active()%')
      then 'protegido por is_current_profile_active()'
    when me.protection_type like 'helper:%'
     and coalesce(pl.qual, '') ilike '%' || split_part(me.protection_type, ':', 2) || '(%'
     and coalesce(hac.checks_active_status, false)
      then 'protegido por helper con status=active'
    when me.protection_type like 'helper:%'
     and coalesce(pl.qual, '') ilike '%' || split_part(me.protection_type, ':', 2) || '(%'
      then 'helper presente — verificar status=active manualmente'
    when me.protection_type = 'intencional:perfil_propio'
      then 'acceso público intencional (perfil propio)'
    else 'pendiente de revisión'
  end as coverage_status,
  case
    when pl.policyname is null then 'FAIL'
    when me.protection_type = 'is_current_profile_active'
     and not (coalesce(pl.qual, '') ilike '%is_current_profile_active()%'
           or coalesce(pl.with_check, '') ilike '%is_current_profile_active()%') then 'FAIL'
    when me.protection_type like 'helper:%'
     and not coalesce(pl.qual, '') ilike '%' || split_part(me.protection_type, ':', 2) || '(%' then 'FAIL'
    when me.protection_type like 'helper:%'
     and not coalesce(hac.checks_active_status, false) then 'WARN'
    else 'PASS'
  end as status
from module_expectations me
left join policy_lookup pl
  on pl.policyname = me.policy_name and pl.tablename = me.table_name
left join helper_active_checks hac
  on hac.helper_name = split_part(me.protection_type, ':', 2)
order by me.module_name, me.table_name;


-- -----------------------------------------------------------------------------
-- SECCIÓN 7 — Verificación funcional READ-ONLY de profile_has_operational_history
-- -----------------------------------------------------------------------------
-- Requiere ejecutar como postgres / service_role en SQL Editor.
-- No usar UUIDs de usuarios reales.

-- 7a. UUID inexistente → false (solo lectura)
select
  'profile_has_operational_history(nonexistent)' as test_case,
  public.profile_has_operational_history('00000000-0000-0000-0000-000000000001'::uuid) as result,
  case
    when public.profile_has_operational_history('00000000-0000-0000-0000-000000000001'::uuid) = false
      then 'PASS'
    else 'FAIL'
  end as status;

-- 7b. UUID nulo → false (la firma uuid no acepta NULL desde SQL sin cast explícito)
-- Nota: revoke_user_auth_sessions(NULL) debe fallar; probar solo en sección manual 12.

-- -----------------------------------------------------------------------------
-- SECCIÓN 8 — RESUMEN AUTOMÁTICO
-- -----------------------------------------------------------------------------

with
col_checks as (
  select case
    when count(*) = 5
     and count(*) filter (
       where status = 'PASS'
     ) = 5 then 'PASS' else 'FAIL' end as status
  from (
    select case
      when c.column_name is not null
       and c.data_type = v.expected_type
       and c.is_nullable = v.expected_nullable then 'PASS'
      else 'FAIL'
    end as status
    from (values
      ('termination_date', 'timestamp with time zone', 'YES'),
      ('termination_reason', 'text', 'YES'),
      ('terminated_by', 'uuid', 'YES'),
      ('reactivated_at', 'timestamp with time zone', 'YES'),
      ('reactivated_by', 'uuid', 'YES')
    ) as v(column_name, expected_type, expected_nullable)
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = 'profiles'
     and c.column_name = v.column_name
  ) s
),
fn_checks as (
  select case
    when count(*) = 3
     and count(*) filter (where status = 'PASS') = 3 then 'PASS' else 'FAIL' end as status
  from (
    select case
      when p.proname is not null
       and p.prosecdef
       and p.proconfig::text ilike '%search_path=%' then 'PASS'
      else 'FAIL'
    end as status
    from (values
      ('is_current_profile_active'),
      ('profile_has_operational_history'),
      ('revoke_user_auth_sessions')
    ) as expected(proname)
    left join pg_proc p on p.proname = expected.proname
    left join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  ) s
),
priv_admin as (
  select case
    when not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'PASS' else 'FAIL' end as status
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'revoke_user_auth_sessions'
),
priv_history as (
  select case
    when not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
      then 'PASS' else 'FAIL' end as status
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'profile_has_operational_history'
),
rls175 as (
  select case
    when count(*) = 31
     and count(*) filter (where status = 'PASS') = 31 then 'PASS' else 'FAIL' end as status
  from (
    select case
      when pol.policyname is not null
       and (coalesce(pol.qual, '') ilike '%is_current_profile_active()%'
         or coalesce(pol.with_check, '') ilike '%is_current_profile_active()%')
        then 'PASS'
      else 'FAIL'
    end as status
    from (values
      ('inventory_items_read_active'),
      ('area_inventory_authenticated_read'),
      ('inventory_movements_authenticated_read'),
      ('inventory_item_barcode_aliases_read'),
      ('inventory_item_merge_audit_read'),
      ('inventory_duplicate_ignore_read'),
      ('inventory_item_unit_conversions_read'),
      ('inventory_unit_conversions_authenticated_read'),
      ('requisitions_authenticated_read'),
      ('requisition_items_authenticated_read'),
      ('pos_orders_authenticated_read'),
      ('pos_order_items_authenticated_read'),
      ('pos_order_events_authenticated_read'),
      ('pos_products_authenticated_read'),
      ('pos_product_variants_authenticated_read'),
      ('pos_product_modifiers_authenticated_read'),
      ('pos_option_groups_authenticated_read'),
      ('pos_option_choices_authenticated_read'),
      ('production_tickets_authenticated_read'),
      ('production_ticket_items_authenticated_read'),
      ('recipes_authenticated_read_active'),
      ('recipe_ingredients_authenticated_read'),
      ('pos_recipe_links_authenticated_read'),
      ('pos_recipe_consumptions_authenticated_read'),
      ('inventory_yield_profiles_read'),
      ('yield_waste_reasons_read'),
      ('yield_audit_campaigns_read'),
      ('yield_audit_campaign_items_read'),
      ('yield_audits_read'),
      ('yield_audits_insert'),
      ('recipe_cost_history_read'),
      ('app_settings_read_authenticated')
    ) as expected(policyname)
    left join pg_policies pol
      on pol.schemaname = 'public' and pol.policyname = expected.policyname
  ) s
),
open_read as (
  select case
    when count(*) filter (
      where trim(both from coalesce(qual, '')) = 'true'
        and policyname not in ('profiles_read_own')
    ) = 0 then 'PASS'
    else 'WARN'
  end as status
  from pg_policies
  where schemaname = 'public'
    and cmd in ('SELECT', 'ALL')
    and 'authenticated' = any (roles)
),
all_checks as (
  select 'profiles_termination_columns' as check_id, status from col_checks
  union all select 'lifecycle_functions_exist', status from fn_checks
  union all select 'revoke_sessions_privileges', status from priv_admin
  union all select 'history_check_privileges', status from priv_history
  union all select 'migration_175_policies', status from rls175
  union all select 'no_open_authenticated_select', status from open_read
)
select check_id, status from all_checks order by check_id;

select
  'USER LIFECYCLE SECURITY VERIFICATION' as report,
  count(*) filter (where status = 'PASS') as passed,
  count(*) filter (where status = 'FAIL') as failed,
  count(*) filter (where status = 'WARN') as warnings
from (
  select status from col_checks
  union all select status from fn_checks
  union all select status from priv_admin
  union all select status from priv_history
  union all select status from rls175
  union all select status from open_read
) summary;


-- =============================================================================
-- SECCIÓN 9 — CHECKLIST MANUAL COMPLEMENTARIA (no automatizable en SQL puro)
-- =============================================================================
/*
A. USUARIO TEMPORAL DE STAGE (crear vía ERP o create-user; prefijo: stage-lifecycle-*)

  [ ] 1. Usuario activo inicia sesión según su rol.
  [ ] 2. Confirmar ≥1 fila en auth.sessions y auth.refresh_tokens para su UUID.
  [ ] 3. Admin ejecuta "Dar de baja" con motivo válido desde ERP.
  [ ] 4. profiles.status = 'inactive'.
  [ ] 5. termination_date, termination_reason, terminated_by poblados.
  [ ] 6. auth.sessions y auth.refresh_tokens = 0 para ese UUID.
  [ ] 7. attendance_credentials sin fila para employee_id = UUID.
  [ ] 8. profiles.authorized_attendance_device IS NULL.
  [ ] 9. Historial operativo (si se insertó prueba controlada) permanece.
  [ ] 10. Consulta REST con JWT anterior a tablas protegidas → vacío / 401 según endpoint.
  [ ] 11. Refresh token posterior → falla.
  [ ] 12. Reactivar desde ERP → status active, reactivated_at/by poblados.
  [ ] 13. Nueva sesión posible; PIN NO restaurado automáticamente.

B. CONSULTAS MANUALES DE APOYO (reemplazar :test_user_id)

  -- Perfil y auditoría de baja
  select id, status, termination_date, termination_reason, terminated_by,
         reactivated_at, reactivated_by, authorized_attendance_device
  from public.profiles
  where id = :test_user_id;

  -- Sesiones (solo lectura antes; comparar después de baja)
  select count(*) as sessions from auth.sessions where user_id = :test_user_id;
  select count(*) as refresh_tokens from auth.refresh_tokens where user_id = :test_user_id;

  -- PIN asistencia
  select * from public.attendance_credentials where employee_id = :test_user_id;

C. profile_has_operational_history (ejecutar como service_role/postgres)

  -- Sin historial (usuario temporal nuevo)
  select public.profile_has_operational_history(:test_user_id);  -- esperado: false

  -- Con referencia controlada (insertar UNA fila de prueba y revertir en transacción)
  begin;
    insert into public.inventory_movements (inventory_item_id, movement_type, quantity, performed_by)
    select id, 'adjustment', 1, :test_user_id
    from public.inventory_items
    limit 1;
    select public.profile_has_operational_history(:test_user_id);  -- esperado: true
  rollback;

  -- UUID inexistente
  select public.profile_has_operational_history('00000000-0000-0000-0000-000000000001');  -- false

D. delete-user (vía ERP o curl manual en Stage; NO automatizar aquí)

  -- Usuario temporal SIN historial → esperado: 200 deleted:true
  -- Usuario temporal CON historial → esperado: 409
  --   "Este usuario posee historial operativo y no puede eliminarse. Utilice \"Dar de baja\"."
  -- Verificar que el mensaje NO contiene nombres de tablas/constraints PG.

E. MATRIZ DE AUTORIZACIÓN Edge Functions (deactivate-user / reactivate-user)

  | Caso                              | HTTP | Resultado esperado                          |
  |-----------------------------------|------|---------------------------------------------|
  | admin → colaborador               | 200  | deactivated:true                            |
  | gerente_general → colaborador     | 200  | deactivated:true                            |
  | gerente_general → admin           | 403  | No tienes permisos...                       |
  | RRHH → colaborador                | 200  | deactivated:true                            |
  | RRHH → gerente_general            | 403  | No tienes permisos...                       |
  | auto-baja                         | 403  | No tienes permisos...                       |
  | actor inactivo                    | 403  | No tienes permisos...                       |
  | objetivo inexistente              | 400  | Usuario no encontrado / error controlado    |
  | motivo vacío                      | 400  | motivo obligatorio (3 a 500 caracteres)     |
  | motivo < 3 chars                  | 400  | motivo obligatorio                          |
  | motivo > 500 chars                | 400  | motivo obligatorio                          |
  | user_id inválido / vacío          | 403  | No tienes permisos...                       |

F. IDEMPOTENCIA Y CONCURRENCIA

  [ ] Dos bajas consecutivas sobre usuario activo:
      - 1ª: deactivated:true, already_inactive:false
      - 2ª: deactivated:true, already_inactive:true (perfil ya inactive)
  [ ] Dos bajas simultáneas (doble clic):
      - Sin error 500; estado final inactive; sesiones revocadas.
  [ ] Reactivar usuario ya activo:
      - reactivated:true, already_active:true
  [ ] Baja de usuario ya inactive:
      - deactivated:true, already_inactive:true; revoca sesiones igualmente.

G. RIESGO DE ESTADO PARCIAL (auditoría de código — NO corregir aún)

  El flujo deactivate-user NO es una sola transacción:
    1) UPDATE profiles
    2) revoke_user_auth_sessions
    3) DELETE attendance_credentials + clear device

  Escenarios de fallo parcial:
    - Falla en (2) después de (1): usuario INACTIVE pero sesiones aún activas → RIESGO MEDIO
    - Falla en (3) después de (2): usuario INACTIVE sin sesiones pero con PIN → RIESGO BAJO

  Mitigación actual: reintentar baja es idempotente y vuelve a ejecutar (2) y (3).
  Recomendación futura (no implementada): transacción SQL única para pasos de BD + cola de revocación.

H. PRUEBA OPCIONAL AISLADA revoke_user_auth_sessions (SOLO usuario temporal)

  -- PRECONDICIÓN: UUID de usuario stage-lifecycle-* con sesión activa.
  -- Ejecutar como service_role/postgres:
  select public.revoke_user_auth_sessions(:test_user_id);
  -- POST: counts en auth.sessions / auth.refresh_tokens = 0
  -- Si usuario sin sesiones: DELETE 0 filas, sin excepción → PASS

I. EVALUACIÓN auth.sessions / auth.refresh_tokens

  - Uso directo es el patrón equivalente a GoTrue models.Logout(user_id).
  - admin.signOut(jwt) de @supabase/supabase-js requiere JWT del usuario, no UUID.
  - Access JWT sigue válido hasta exp; refresh bloqueado → coherente con docs Supabase.
  - Tablas auth.* no expuestas a authenticated; solo SECURITY DEFINER + service_role.

J. CRITERIO DE APTITUD

  APTO PARA PRODUCCIÓN si:
    - Todas las comprobaciones automáticas = PASS
    - Warnings = 0 o justificados (p. ej. políticas USING(true) residuales documentadas)
    - Checklist manual A–F completada en Stage sin FAIL
    - Edge Functions desplegadas en Stage

  APTO CON ADVERTENCIAS si:
    - FAIL = 0 pero WARN > 0 (p. ej. políticas abiertas residuales en módulos secundarios)
    - Estado parcial documentado en G aceptado con procedimiento de reintento

  NO APTO si:
    - Cualquier FAIL en columnas, funciones, privilegios o políticas 175
    - authenticated/anon pueden ejecutar revoke_user_auth_sessions o profile_has_operational_history
    - delete-user filtra errores internos de PostgreSQL al cliente
*/
