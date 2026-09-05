-- FELplex Stage — rollback for felplex_gt_billing_bootstrap.sql.
-- Manual execution ONLY in Supabase Stage SQL Editor (project ref tgrqarxfmpwgrkntvgma).
-- Stage-only, fail-closed. Does NOT touch fel_emission_config, orders, or FEL documents.
-- NOT EXECUTED IN STAGE as of fixture version commit.

begin;

select pg_advisory_xact_lock(hashtext('felplex_gt_billing_bootstrap'));

-- ---------------------------------------------------------------------------
-- Preflight guards (same Stage identity via fel_emission_config)
-- ---------------------------------------------------------------------------

do $felplex_gt_billing_bootstrap_rollback_guard$
begin
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
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_REFUSED: fel_emission_config id=1 not in '
      'safe Stage state (environment=stage, all switches false).';
  end if;

  if exists (
    select 1
    from public.pos_fel_documents
    where status in ('certified', 'processing')
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_REFUSED: pos_fel_documents certified/processing exist.';
  end if;

  if exists (
    select 1
    from public.pos_fel_attempts
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_REFUSED: pos_fel_attempts is not empty.';
  end if;
end;
$felplex_gt_billing_bootstrap_rollback_guard$;

-- ---------------------------------------------------------------------------
-- Identity guards — abort if bootstrap rows diverge from expected Stage values
-- ---------------------------------------------------------------------------

do $$
declare
  v_config_id uuid;
  v_legal_entity_id uuid;
begin
  select ent.id into v_legal_entity_id
  from public.billing_legal_entities ent
  where ent.code = 'default';

  select cfg.id into v_config_id
  from public.billing_provider_configs cfg
  where cfg.provider_code = 'felplex_gt'
    and cfg.environment = 'stage'
    and cfg.legal_entity_id is not distinct from v_legal_entity_id;

  if v_legal_entity_id is not null and exists (
    select 1
    from public.billing_legal_entities
    where id = v_legal_entity_id
      and (
        code is distinct from 'default'
        or legal_name is distinct from 'Pruebas Gran Alcazar'
        or trade_name is distinct from 'Pruebas Gran Alcazar'
        or tax_id is distinct from '326070'
        or country_code is distinct from 'GT'
        or currency_code is distinct from 'GTQ'
        or is_default is distinct from true
        or is_active is distinct from true
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: legal entity code=default has non-bootstrap values.';
  end if;

  if exists (
    select 1
    from public.billing_providers
    where code = 'felplex_gt'
      and (
        name is distinct from 'FELplex Guatemala'
        or adapter_key is distinct from 'felplex_gt'
        or adapter_version is distinct from '1.0.0'
        or is_active is distinct from true
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: billing_providers felplex_gt has non-bootstrap values.';
  end if;

  if v_config_id is not null and exists (
    select 1
    from public.billing_provider_configs cfg
    where cfg.id = v_config_id
      and (
        cfg.entity_id is distinct from '547'
        or cfg.base_url is distinct from 'https://felplex.stage.plex.lat'
        or cfg.secret_env_var is distinct from 'FELPLEX_GT_STAGE_API_KEY'
        or cfg.environment is distinct from 'stage'
        or cfg.is_default is distinct from true
        or cfg.is_active is distinct from true
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: felplex_gt/stage config has non-bootstrap values.';
  end if;

  if v_config_id is not null and exists (
    select 1
    from public.billing_provider_configs
    where provider_code = 'felplex_gt'
      and environment = 'stage'
      and id is distinct from v_config_id
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: multiple felplex_gt/stage provider configs exist.';
  end if;

  if v_config_id is not null and exists (
    select 1
    from public.billing_documents
    where provider_config_id = v_config_id
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: billing_documents reference bootstrap config.';
  end if;

  if v_config_id is not null and exists (
    select 1
    from public.billing_certification_attempts
    where provider_config_id = v_config_id
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: billing_certification_attempts reference bootstrap config.';
  end if;

  if v_legal_entity_id is not null and exists (
    select 1
    from public.billing_documents
    where legal_entity_id = v_legal_entity_id
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: billing_documents reference bootstrap legal entity.';
  end if;

  if v_legal_entity_id is not null and exists (
    select 1
    from public.billing_provider_configs cfg
    where cfg.legal_entity_id = v_legal_entity_id
      and cfg.id is distinct from v_config_id
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: other provider configs reference bootstrap legal entity.';
  end if;

  if exists (
    select 1
    from public.billing_providers prov
    where prov.code = 'felplex_gt'
      and exists (
        select 1
        from public.billing_provider_configs cfg
        where cfg.provider_code = prov.code
          and cfg.id is distinct from v_config_id
      )
  ) then
    raise exception
      'FELPLEX_GT_BILLING_BOOTSTRAP_ROLLBACK_BLOCKED: felplex_gt has configs beyond bootstrap row.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Deletes (reverse FK order; strict filters; no CASCADE / TRUNCATE)
-- ---------------------------------------------------------------------------

delete from public.billing_provider_status st
using public.billing_provider_configs cfg,
      public.billing_legal_entities ent
where st.provider_config_id = cfg.id
  and cfg.legal_entity_id = ent.id
  and ent.code = 'default'
  and cfg.provider_code = 'felplex_gt'
  and cfg.environment = 'stage'
  and cfg.entity_id = '547'
  and cfg.base_url = 'https://felplex.stage.plex.lat'
  and cfg.secret_env_var = 'FELPLEX_GT_STAGE_API_KEY';

delete from public.billing_provider_configs cfg
using public.billing_legal_entities ent
where cfg.legal_entity_id = ent.id
  and ent.code = 'default'
  and cfg.provider_code = 'felplex_gt'
  and cfg.environment = 'stage'
  and cfg.entity_id = '547'
  and cfg.base_url = 'https://felplex.stage.plex.lat'
  and cfg.secret_env_var = 'FELPLEX_GT_STAGE_API_KEY';

delete from public.billing_providers
where code = 'felplex_gt'
  and not exists (
    select 1
    from public.billing_provider_configs cfg
    where cfg.provider_code = billing_providers.code
  );

delete from public.billing_legal_entities ent
where ent.code = 'default'
  and ent.tax_id = '326070'
  and ent.legal_name = 'Pruebas Gran Alcazar'
  and not exists (
    select 1 from public.billing_provider_configs cfg where cfg.legal_entity_id = ent.id
  )
  and not exists (
    select 1 from public.billing_documents doc where doc.legal_entity_id = ent.id
  )
  and not exists (
    select 1 from public.billing_provider_status st where st.legal_entity_id = ent.id
  );

commit;
