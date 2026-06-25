-- Debug logs for inbound webhooks (Wix recruitment, etc.) while integrations are tuned.
-- Apply after 124_recruitment_website_applications.sql.

create table if not exists public.webhook_debug_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  source text not null default 'wix-recruitment-application',
  http_method text,
  request_url text,
  request_headers jsonb not null default '{}'::jsonb,
  content_type text,
  raw_body text,
  parsed_body jsonb,
  outcome text not null default 'received',
  error_message text,
  error_detail jsonb,
  response_body jsonb,
  created_at timestamptz not null default now()
);

create index if not exists webhook_debug_logs_created_at_idx
  on public.webhook_debug_logs (created_at desc);

create index if not exists webhook_debug_logs_request_id_idx
  on public.webhook_debug_logs (request_id);

create index if not exists webhook_debug_logs_source_created_at_idx
  on public.webhook_debug_logs (source, created_at desc);

alter table public.webhook_debug_logs enable row level security;

drop policy if exists webhook_debug_logs_select_admin on public.webhook_debug_logs;
create policy webhook_debug_logs_select_admin
  on public.webhook_debug_logs
  for select
  to authenticated
  using (
    public.normalize_profile_role(public.current_profile_role()) in (
      'admin', 'gerente_general', 'recursos_humanos', 'rrhh'
    )
  );

revoke all on public.webhook_debug_logs from public;
grant select on public.webhook_debug_logs to authenticated;
grant all on public.webhook_debug_logs to service_role;
