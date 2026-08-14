-- FELplex Stage — billing bootstrap (legal entity + felplex_gt catalog + Stage config).
-- Manual execution ONLY in Supabase Stage SQL Editor (project ref tgrqarxfmpwgrkntvgma).
-- NOT a migration. Does NOT enable emission, HTTP, or Edge secrets.
-- NOT EXECUTED IN STAGE as of fixture version commit.

begin;

select pg_advisory_xact_lock(hashtext('felplex_gt_billing_bootstrap'));

-- ---------------------------------------------------------------------------
-- Preflight guards (Stage demonstrated via fel_emission_config — fail-closed)
-- ---------------------------------------------------------------------------

do $felplex_gt_billing_bootstrap_guard$
declare
  v_config_count integer;
begin
  select count(*) into v_config_count
  from public.fel_emission_config;

  if v_config_count <> 1 then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: expected exactly one fel_emission_config row (found %).',
      v_config_count;
  end if;

  if not exists (
    select 1
    from public.fel_emission_config
    where id = 1
      and environment = 'stage'
      and emission_enabled = false
      and auto_issue_paid_orders = false
      and formal_contingency_enabled = false
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: fel_emission_config id=1 must be '
      'environment=stage with emission_enabled, auto_issue_paid_orders and '
      'formal_contingency_enabled all false.';
  end if;

  if exists (
    select 1
    from public.billing_provider_configs
    where environment = 'production'
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: production billing_provider_configs exist.';
  end if;

  if exists (
    select 1
    from public.billing_legal_entities
    where is_default = true
      and is_active = true
      and code is distinct from 'default'
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: unexpected active default legal entity '
      'distinct from code=default.';
  end if;

  if exists (
    select 1
    from public.billing_legal_entities
    where code = 'default'
      and (
        legal_name is distinct from 'Pruebas Gran Alcazar'
        or trade_name is distinct from 'Pruebas Gran Alcazar'
        or tax_id is distinct from '326070'
        or country_code is distinct from 'GT'
        or currency_code is distinct from 'GTQ'
        or is_default is distinct from true
        or is_active is distinct from true
        or settings is distinct from '{}'::jsonb
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: billing_legal_entities code=default '
      'exists with incompatible values (expected Stage bootstrap identity).';
  end if;

  if position('-' in '326070') > 0 then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: tax_id literal must not contain hyphens.';
  end if;

  if exists (
    select 1
    from public.billing_providers
    where code = 'felplex_gt'
      and (
        name is distinct from 'FELplex Guatemala'
        or country_code is distinct from 'GT'
        or adapter_key is distinct from 'felplex_gt'
        or adapter_version is distinct from '1.0.0'
        or is_active is distinct from true
        or capabilities is distinct from '{}'::jsonb
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: billing_providers code=felplex_gt '
      'exists with incompatible catalog values.';
  end if;

  if exists (
    select 1
    from public.billing_provider_configs cfg
    join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
    where cfg.provider_code = 'felplex_gt'
      and cfg.environment = 'stage'
      and ent.code = 'default'
      and (
        cfg.entity_id is distinct from '547'
        or cfg.base_url is distinct from 'https://felplex.stage.plex.lat'
        or cfg.secret_env_var is distinct from 'FELPLEX_GT_STAGE_API_KEY'
        or cfg.is_default is distinct from true
        or cfg.is_active is distinct from true
        or cfg.issuer_settings is distinct from '{}'::jsonb
        or cfg.adapter_version is not null
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: felplex_gt/stage config for legal entity '
      'default exists with incompatible operational values.';
  end if;

  if exists (
    select 1
    from public.billing_provider_configs cfg
    join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
    where cfg.provider_code = 'felplex_gt'
      and cfg.environment = 'stage'
      and ent.code = 'default'
      and cfg.entity_id = '547'
      and cfg.base_url = 'https://felplex.stage.plex.lat'
      and cfg.secret_env_var = 'FELPLEX_GT_STAGE_API_KEY'
      and cfg.is_default = true
      and cfg.is_active = true
  ) then
    null;
  elsif exists (
    select 1
    from public.billing_provider_configs
    where provider_code = 'felplex_gt'
      and environment = 'stage'
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_REFUSED: felplex_gt/stage config exists but is '
      'not bound to legal entity code=default with expected Stage values.';
  end if;
end;
$felplex_gt_billing_bootstrap_guard$;

-- ---------------------------------------------------------------------------
-- 1. billing_legal_entities (code=default)
-- ---------------------------------------------------------------------------

insert into public.billing_legal_entities (
  code,
  legal_name,
  trade_name,
  tax_id,
  country_code,
  currency_code,
  is_default,
  is_active,
  settings
) values (
  'default',
  'Pruebas Gran Alcazar',
  'Pruebas Gran Alcazar',
  '326070',
  'GT',
  'GTQ',
  true,
  true,
  '{}'::jsonb
)
on conflict (code) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.billing_legal_entities
    where code = 'default'
      and legal_name = 'Pruebas Gran Alcazar'
      and trade_name = 'Pruebas Gran Alcazar'
      and tax_id = '326070'
      and country_code = 'GT'
      and currency_code = 'GTQ'
      and is_default = true
      and is_active = true
      and settings = '{}'::jsonb
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_MISMATCH: billing_legal_entities code=default '
      'missing or has unexpected values after insert.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. billing_providers (catalog felplex_gt)
-- ---------------------------------------------------------------------------

insert into public.billing_providers (
  code,
  name,
  country_code,
  adapter_key,
  adapter_version,
  is_active,
  capabilities
) values (
  'felplex_gt',
  'FELplex Guatemala',
  'GT',
  'felplex_gt',
  '1.0.0',
  true,
  '{}'::jsonb
)
on conflict (code) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.billing_providers
    where code = 'felplex_gt'
      and name = 'FELplex Guatemala'
      and country_code = 'GT'
      and adapter_key = 'felplex_gt'
      and adapter_version = '1.0.0'
      and is_active = true
      and capabilities = '{}'::jsonb
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_MISMATCH: billing_providers code=felplex_gt '
      'missing or has unexpected values after insert.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. billing_provider_configs (Stage operational config)
-- ---------------------------------------------------------------------------

do $$
declare
  v_legal_entity_id uuid;
begin
  select id into v_legal_entity_id
  from public.billing_legal_entities
  where code = 'default'
    and is_default = true
    and is_active = true;

  if v_legal_entity_id is null then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_MISMATCH: default legal entity id not resolved.';
  end if;

  insert into public.billing_provider_configs (
    legal_entity_id,
    provider_code,
    environment,
    entity_id,
    secret_env_var,
    base_url,
    adapter_version,
    is_default,
    is_active,
    issuer_settings
  ) values (
    v_legal_entity_id,
    'felplex_gt',
    'stage',
    '547',
    'FELPLEX_GT_STAGE_API_KEY',
    'https://felplex.stage.plex.lat',
    null,
    true,
    true,
    '{}'::jsonb
  )
  on conflict (legal_entity_id, provider_code, environment) do nothing;
end $$;

do $$
begin
  if not exists (
    select 1
    from public.billing_provider_configs cfg
    join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
    where ent.code = 'default'
      and cfg.provider_code = 'felplex_gt'
      and cfg.environment = 'stage'
      and cfg.entity_id = '547'
      and cfg.base_url = 'https://felplex.stage.plex.lat'
      and cfg.secret_env_var = 'FELPLEX_GT_STAGE_API_KEY'
      and cfg.adapter_version is null
      and cfg.is_default = true
      and cfg.is_active = true
      and cfg.issuer_settings = '{}'::jsonb
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_MISMATCH: billing_provider_configs felplex_gt/stage '
      'missing or has unexpected values after insert.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. billing_provider_status (initial unknown — not verified)
-- ---------------------------------------------------------------------------

insert into public.billing_provider_status (
  provider_config_id,
  legal_entity_id,
  provider_code,
  adapter_version,
  connection_status
)
select
  cfg.id,
  cfg.legal_entity_id,
  cfg.provider_code,
  coalesce(cfg.adapter_version, prov.adapter_version),
  'unknown'
from public.billing_provider_configs cfg
join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
join public.billing_providers prov on prov.code = cfg.provider_code
where ent.code = 'default'
  and cfg.provider_code = 'felplex_gt'
  and cfg.environment = 'stage'
on conflict (provider_config_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.billing_provider_status st
    join public.billing_provider_configs cfg on cfg.id = st.provider_config_id
    join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
    where ent.code = 'default'
      and cfg.provider_code = 'felplex_gt'
      and cfg.environment = 'stage'
      and st.connection_status = 'unknown'
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_MISMATCH: billing_provider_status missing or '
      'connection_status is not unknown.';
  end if;
end $$;

commit;
