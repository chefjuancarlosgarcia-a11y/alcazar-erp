-- Rollback for 201_pos_fel_documents.sql (final version)
-- WARNING: Apply manually ONLY on isolated Supabase STAGE when reversing migration 201.
-- DO NOT run on Production. DO NOT execute in deploy pipelines.
--
-- Drops ONLY objects created by supabase/schema/201_pos_fel_documents.sql.
-- Does NOT drop test_pos_fel_documents_201 (lives in 201_test_pos_fel_documents.sql only).
-- Does NOT touch pos_orders, pos_order_payments, customers, products, cash, or other migrations.
-- No broad CASCADE.

-- Public RPCs (depend on internal helpers and tables)
drop function if exists public.request_pos_fel_certification(uuid, text, text, text, text, numeric);
drop function if exists public.get_pos_fel_document_status(uuid);

-- Internal SECURITY DEFINER helpers
drop function if exists public.fel_build_order_items_snapshot(uuid);
drop function if exists public.fel_order_payment_reconciliation(uuid);
drop function if exists public.fel_get_emission_config();

-- IMMUTABLE / helper functions
drop function if exists public.fel_sanitize_public_error(text);
drop function if exists public.fel_normalize_receiver_nit(text);
drop function if exists public.fel_build_external_id(uuid);
drop function if exists public.fel_assert_tax_reconciliation(numeric, numeric, numeric);
drop function if exists public.fel_vat_from_gross_included(numeric, numeric);
drop function if exists public.fel_taxable_base_from_gross(numeric, numeric);
drop function if exists public.fel_round_money(numeric);

-- Permission helpers
drop function if exists public.fel_can_view_fel_documents();
drop function if exists public.fel_can_manage_fel_documents();
drop function if exists public.fel_can_request_fel_certification();

-- Tables (indexes and policies drop with tables)
drop table if exists public.pos_fel_attempts;
drop table if exists public.pos_fel_documents;
drop table if exists public.fel_emission_config;
