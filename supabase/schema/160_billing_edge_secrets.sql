-- Billing Phase 0 — Edge Function Secrets (replaces Supabase Vault dependency)
-- Apply after 159_billing_foundation.sql

-- ---------------------------------------------------------------------------
-- Drop Vault RPC (secrets now live in Edge Function env, not Postgres)
-- ---------------------------------------------------------------------------

drop function if exists public.get_billing_vault_secret(text);

-- ---------------------------------------------------------------------------
-- Rename logical secret reference column (value never stored — env var name only)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_provider_configs'
      and column_name = 'vault_secret_name'
  ) then
    alter table public.billing_provider_configs
      rename column vault_secret_name to secret_env_var;
  end if;
end $$;

comment on column public.billing_provider_configs.secret_env_var is
  'Nombre logico del Edge Function Secret (ej. FELPLEX_GT_STAGE_API_KEY). El valor sensible vive en Deno.env, no en la base de datos.';

-- Migrate legacy Vault secret names to Edge Function env var names
update public.billing_provider_configs
set secret_env_var = case environment
  when 'stage' then 'FELPLEX_GT_STAGE_API_KEY'
  when 'production' then 'FELPLEX_GT_PRODUCTION_API_KEY'
  else secret_env_var
end
where coalesce(trim(secret_env_var), '') = ''
   or secret_env_var in ('billing_felplex_gt_stage', 'billing_felplex_gt_production');

-- ---------------------------------------------------------------------------
-- Provider config RPCs (secret_env_var)
-- ---------------------------------------------------------------------------

create or replace function public.list_billing_provider_configs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.can_view_billing_settings() then
    raise exception 'No tienes permiso para consultar configuracion de proveedores.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', cfg.id,
      'legal_entity_id', cfg.legal_entity_id,
      'legal_entity_code', ent.code,
      'legal_entity_name', ent.legal_name,
      'provider_code', cfg.provider_code,
      'provider_name', prov.name,
      'environment', cfg.environment,
      'entity_id', cfg.entity_id,
      'secret_env_var', cfg.secret_env_var,
      'base_url', cfg.base_url,
      'adapter_version', coalesce(cfg.adapter_version, prov.adapter_version),
      'is_default', cfg.is_default,
      'is_active', cfg.is_active,
      'issuer_settings', cfg.issuer_settings,
      'updated_at', cfg.updated_at
    )
    order by ent.code, cfg.provider_code, cfg.environment
  ), '[]'::jsonb) into v_rows
  from public.billing_provider_configs cfg
  join public.billing_legal_entities ent on ent.id = cfg.legal_entity_id
  join public.billing_providers prov on prov.code = cfg.provider_code;

  return v_rows;
end;
$$;

create or replace function public.upsert_billing_provider_config(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing public.billing_provider_configs;
  v_row public.billing_provider_configs;
  v_legal_entity_id uuid;
  v_secret_env_var text;
begin
  if not public.can_manage_billing_settings() then
    raise exception 'No tienes permiso para modificar configuracion de proveedores.';
  end if;

  v_id := nullif(p_data ->> 'id', '')::uuid;

  v_legal_entity_id := coalesce(
    nullif(p_data ->> 'legal_entity_id', '')::uuid,
    public.get_default_billing_legal_entity_id()
  );

  if v_legal_entity_id is null then
    raise exception 'No existe entidad legal predeterminada.';
  end if;

  v_secret_env_var := coalesce(
    nullif(p_data ->> 'secret_env_var', ''),
    nullif(p_data ->> 'vault_secret_name', ''),
    case coalesce(p_data ->> 'environment', 'stage')
      when 'production' then 'FELPLEX_GT_PRODUCTION_API_KEY'
      else 'FELPLEX_GT_STAGE_API_KEY'
    end
  );

  if v_id is not null then
    select * into v_existing from public.billing_provider_configs where id = v_id;
    if v_existing.id is null then
      raise exception 'Configuracion de proveedor no encontrada.';
    end if;
  end if;

  if v_id is null then
    insert into public.billing_provider_configs (
      legal_entity_id, provider_code, environment, entity_id,
      secret_env_var, base_url, adapter_version,
      is_default, is_active, issuer_settings, updated_by
    ) values (
      v_legal_entity_id,
      coalesce(p_data ->> 'provider_code', 'felplex_gt'),
      coalesce(p_data ->> 'environment', 'stage'),
      coalesce(p_data ->> 'entity_id', ''),
      v_secret_env_var,
      nullif(p_data ->> 'base_url', ''),
      nullif(p_data ->> 'adapter_version', ''),
      coalesce((p_data ->> 'is_default')::boolean, false),
      coalesce((p_data ->> 'is_active')::boolean, true),
      coalesce(p_data -> 'issuer_settings', '{}'::jsonb),
      auth.uid()
    ) returning * into v_row;

    perform public.billing_log_config_change(
      'billing_provider_configs', v_row.id::text, '_record',
      null, to_jsonb(v_row), 'insert'
    );
  else
    update public.billing_provider_configs cfg
    set
      entity_id = coalesce(nullif(p_data ->> 'entity_id', ''), cfg.entity_id),
      secret_env_var = coalesce(nullif(p_data ->> 'secret_env_var', ''), nullif(p_data ->> 'vault_secret_name', ''), cfg.secret_env_var),
      base_url = coalesce(nullif(p_data ->> 'base_url', ''), cfg.base_url),
      adapter_version = coalesce(nullif(p_data ->> 'adapter_version', ''), cfg.adapter_version),
      is_default = coalesce((p_data ->> 'is_default')::boolean, cfg.is_default),
      is_active = coalesce((p_data ->> 'is_active')::boolean, cfg.is_active),
      issuer_settings = coalesce(p_data -> 'issuer_settings', cfg.issuer_settings),
      updated_by = auth.uid()
    where cfg.id = v_id
    returning * into v_row;

    if v_existing.entity_id is distinct from v_row.entity_id then
      perform public.billing_log_config_change(
        'billing_provider_configs', v_row.id::text, 'entity_id',
        to_jsonb(v_existing.entity_id), to_jsonb(v_row.entity_id), 'update'
      );
    end if;
    if v_existing.secret_env_var is distinct from v_row.secret_env_var then
      perform public.billing_log_config_change(
        'billing_provider_configs', v_row.id::text, 'secret_env_var',
        to_jsonb(v_existing.secret_env_var), to_jsonb(v_row.secret_env_var), 'update'
      );
    end if;
  end if;

  insert into public.billing_provider_status (
    provider_config_id, legal_entity_id, provider_code, adapter_version
  ) values (
    v_row.id, v_row.legal_entity_id, v_row.provider_code,
    coalesce(v_row.adapter_version, (select adapter_version from public.billing_providers where code = v_row.provider_code))
  )
  on conflict (provider_config_id) do nothing;

  return (
    select elem from jsonb_array_elements(public.list_billing_provider_configs()) elem
    where elem ->> 'id' = v_row.id::text
    limit 1
  );
end;
$$;

create or replace function public.get_billing_provider_config_for_service(
  p_provider_code text,
  p_environment text,
  p_legal_entity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entity_id uuid;
  v_row record;
begin
  v_entity_id := coalesce(p_legal_entity_id, public.get_default_billing_legal_entity_id());

  select
    cfg.id,
    cfg.legal_entity_id,
    cfg.provider_code,
    cfg.environment,
    cfg.entity_id,
    cfg.secret_env_var,
    cfg.base_url,
    coalesce(cfg.adapter_version, prov.adapter_version) as adapter_version,
    prov.adapter_key,
    prov.name as provider_name
  into v_row
  from public.billing_provider_configs cfg
  join public.billing_providers prov on prov.code = cfg.provider_code
  where cfg.legal_entity_id = v_entity_id
    and cfg.provider_code = p_provider_code
    and cfg.environment = p_environment
    and cfg.is_active = true
  order by cfg.is_default desc, cfg.updated_at desc
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'legal_entity_id', v_row.legal_entity_id,
    'provider_code', v_row.provider_code,
    'environment', v_row.environment,
    'entity_id', v_row.entity_id,
    'secret_env_var', v_row.secret_env_var,
    'base_url', v_row.base_url,
    'adapter_version', v_row.adapter_version,
    'adapter_key', v_row.adapter_key,
    'provider_name', v_row.provider_name
  );
end;
$$;
