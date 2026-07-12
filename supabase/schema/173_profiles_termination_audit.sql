-- Profile termination / reactivation audit fields for secure user offboarding.
-- Apply after 172_create_internal_production_output_item.sql.

alter table public.profiles
  add column if not exists termination_date timestamptz,
  add column if not exists termination_reason text,
  add column if not exists terminated_by uuid references public.profiles(id) on delete set null,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.profiles(id) on delete set null;

create index if not exists profiles_status_active_idx
  on public.profiles (status)
  where status = 'active';

create index if not exists profiles_terminated_at_idx
  on public.profiles (termination_date desc)
  where status = 'inactive';

create index if not exists profiles_terminated_by_idx
  on public.profiles (terminated_by)
  where terminated_by is not null;
