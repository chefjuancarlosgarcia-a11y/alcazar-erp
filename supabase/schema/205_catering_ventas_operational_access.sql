-- Restore operational catering access for ventas (independent from notification roles).
-- Apply after 204_finance_accounting_journal_engine.sql

comment on function public.catering_notification_roles() is
  'Roles that receive catering notifications. Operational module access uses can_manage_catering_requests().';

create or replace function public.can_manage_catering_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and public.normalize_profile_role(profile.role) in (
        'admin',
        'gerente_general',
        'gerente',
        'gerente_operaciones',
        'supervisor',
        'ventas'
      )
  );
$$;

revoke all on function public.can_manage_catering_requests() from public;
grant execute on function public.can_manage_catering_requests() to authenticated;

insert into public.user_roles (role_key, role_name, description, category, is_system, is_active)
values (
  'ventas',
  'Ventas',
  'Asesoría comercial y operación del módulo Catering.',
  'Administración',
  true,
  true
)
on conflict (role_key) do nothing;
