-- App settings for configurable ERP branding.
-- Apply after 042_operational_alert_notifications.sql.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.app_settings enable row level security;

grant select on public.app_settings to authenticated;
grant insert, update on public.app_settings to authenticated;

drop policy if exists "app_settings_read_authenticated" on public.app_settings;
create policy "app_settings_read_authenticated"
  on public.app_settings for select to authenticated
  using (true);

drop policy if exists "app_settings_write_admins" on public.app_settings;
create policy "app_settings_write_admins"
  on public.app_settings for all to authenticated
  using (public.current_profile_role() in ('admin', 'gerente_general'))
  with check (public.current_profile_role() in ('admin', 'gerente_general'));

create or replace function public.touch_app_settings_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists touch_app_settings_updated_at on public.app_settings;
create trigger touch_app_settings_updated_at
  before insert or update on public.app_settings
  for each row execute function public.touch_app_settings_updated_at();

insert into public.app_settings (key, value)
values (
  'system_branding',
  jsonb_build_object(
    'commercialName', 'Pizzería El Gran Alcázar',
    'subtitle', 'Sistema operativo interno',
    'logoUrl', '',
    'monogram', 'GA',
    'accentColor', '#14b8a6'
  )
)
on conflict (key) do nothing;
