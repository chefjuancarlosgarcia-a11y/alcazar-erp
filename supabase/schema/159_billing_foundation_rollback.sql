-- Rollback companion for 159_billing_foundation.sql
-- Apply only in controlled rollback — Phase 0 should have no operational billing data.

drop view if exists public.billing_monitoring_document_counts;

drop function if exists public.list_billing_config_audit(integer);
drop function if exists public.list_billing_documents(jsonb);
drop function if exists public.get_billing_vault_secret(text);
drop function if exists public.get_billing_provider_config_for_service(text, text, uuid);
drop function if exists public.record_billing_certification_attempt(jsonb);
drop function if exists public.get_billing_monitoring_summary(uuid);
drop function if exists public.upsert_billing_provider_config(jsonb);
drop function if exists public.list_billing_provider_configs();
drop function if exists public.get_default_billing_legal_entity_id();
drop function if exists public.list_billing_legal_entities();
drop function if exists public.is_billing_emission_enabled();
drop function if exists public.set_billing_settings(jsonb);
drop function if exists public.get_billing_settings();
drop function if exists public.billing_settings_default();
drop function if exists public.can_retry_billing_certification();
drop function if exists public.can_view_billing_documents();
drop function if exists public.can_view_billing_settings();
drop function if exists public.can_manage_billing_settings();
drop function if exists public.billing_log_config_change(text, text, text, jsonb, jsonb, text, jsonb);
drop function if exists public.billing_touch_updated_at();

drop table if exists public.billing_provider_status cascade;
drop table if exists public.billing_config_audit_log cascade;
drop table if exists public.billing_document_links cascade;
drop table if exists public.billing_certification_attempts cascade;
drop table if exists public.billing_document_lines cascade;
drop table if exists public.billing_documents cascade;
drop table if exists public.billing_provider_configs cascade;
drop table if exists public.billing_providers cascade;
drop table if exists public.billing_legal_entities cascade;

delete from public.app_settings where key = 'billing_settings';
