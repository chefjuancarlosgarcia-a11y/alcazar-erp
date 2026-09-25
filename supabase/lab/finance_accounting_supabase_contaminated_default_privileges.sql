-- Simulates Supabase hosted default ACLs on future public tables (lab only).
-- Apply after bootstrap-supabase-local.sql and before finance migrations 202-204.

alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger
  on tables to authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger
  on tables to anon;

alter default privileges for role postgres in schema public
  grant all on tables to service_role;

alter default privileges for role postgres in schema public
  grant all on sequences to authenticated, anon, service_role;
