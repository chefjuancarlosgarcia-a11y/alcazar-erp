-- Branding assets storage and extended theme defaults.
-- Apply after 053_fixed_costs_management.sql.
-- Safe on fresh Supabase: creates app_settings if 043 was never applied.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.app_settings enable row level security;

grant select on public.app_settings to authenticated;
grant insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

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

insert into storage.buckets (id, name, public)
values ('branding-assets', 'branding-assets', true)
on conflict (id) do nothing;

drop policy if exists "branding_assets_public_read" on storage.objects;
create policy "branding_assets_public_read" on storage.objects
  for select using (bucket_id = 'branding-assets');

drop policy if exists "branding_assets_admins_insert" on storage.objects;
create policy "branding_assets_admins_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'branding-assets'
    and public.current_profile_role() in ('admin', 'gerente_general')
  );

drop policy if exists "branding_assets_admins_update" on storage.objects;
create policy "branding_assets_admins_update" on storage.objects
  for update to authenticated using (
    bucket_id = 'branding-assets'
    and public.current_profile_role() in ('admin', 'gerente_general')
  ) with check (
    bucket_id = 'branding-assets'
    and public.current_profile_role() in ('admin', 'gerente_general')
  );

drop policy if exists "branding_assets_admins_delete" on storage.objects;
create policy "branding_assets_admins_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'branding-assets'
    and public.current_profile_role() in ('admin', 'gerente_general')
  );

insert into public.app_settings (key, value)
values (
  'system_branding',
  jsonb_build_object(
    'commercialName', 'Pizzería El Gran Alcázar',
    'subtitle', 'Sistema operativo interno',
    'logoUrl', '',
    'compactLogoUrl', '',
    'monogram', 'GA',
    'primaryColor', '#14b8a6',
    'secondaryColor', '#0f766e',
    'accentColor', '#2dd4bf',
    'backgroundColor', '#071023',
    'surfaceColor', '#0f172a',
    'successColor', '#22c55e',
    'warningColor', '#f59e0b',
    'dangerColor', '#ef4444',
    'textPrimary', '#f8fafc',
    'textSecondary', '#94a3b8',
    'presetTheme', 'alcazar',
    'paletteVariant', 'corporate',
    'themeMode', 'dark',
    'density', 'normal',
    'borderStyle', 'soft'
  )
)
on conflict (key) do nothing;

-- Merge extended theme keys into existing branding without overwriting custom values.
update public.app_settings
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
  'primaryColor', coalesce(value ->> 'primaryColor', value ->> 'accentColor', '#14b8a6'),
  'secondaryColor', coalesce(value ->> 'secondaryColor', '#0f766e'),
  'accentColor', coalesce(value ->> 'accentColor', '#2dd4bf'),
  'backgroundColor', coalesce(value ->> 'backgroundColor', '#071023'),
  'surfaceColor', coalesce(value ->> 'surfaceColor', '#0f172a'),
  'successColor', coalesce(value ->> 'successColor', '#22c55e'),
  'warningColor', coalesce(value ->> 'warningColor', '#f59e0b'),
  'dangerColor', coalesce(value ->> 'dangerColor', '#ef4444'),
  'textPrimary', coalesce(value ->> 'textPrimary', '#f8fafc'),
  'textSecondary', coalesce(value ->> 'textSecondary', '#94a3b8'),
  'compactLogoUrl', coalesce(value ->> 'compactLogoUrl', ''),
  'presetTheme', coalesce(value ->> 'presetTheme', 'alcazar'),
  'paletteVariant', coalesce(value ->> 'paletteVariant', 'corporate'),
  'themeMode', coalesce(value ->> 'themeMode', 'dark'),
  'density', coalesce(value ->> 'density', 'normal'),
  'borderStyle', coalesce(value ->> 'borderStyle', 'soft')
)
where key = 'system_branding';
