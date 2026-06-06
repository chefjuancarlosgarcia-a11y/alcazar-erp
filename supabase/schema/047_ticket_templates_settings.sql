-- Configurable POS ticket templates.
-- Apply after 046_pos_customers_sales_channels.sql.

create table if not exists public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key in ('prebill', 'final_bill', 'delivery', 'takeout', 'kitchen')),
  name text not null,
  description text,
  paper_width text not null default '80mm' check (paper_width in ('58mm', '80mm', 'letter')),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ticket_templates_one_active_default_idx
  on public.ticket_templates (template_key)
  where is_default = true and status = 'active';

create index if not exists ticket_templates_key_status_idx
  on public.ticket_templates (template_key, status, is_default desc);

alter table public.ticket_templates enable row level security;

grant select on public.ticket_templates to authenticated;
grant insert, update, delete on public.ticket_templates to authenticated;
grant all on public.ticket_templates to service_role;

create or replace function public.can_read_ticket_templates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'supervisor', 'cajero', 'caja', 'mesero', 'servicio')
      and status = 'active'
  );
$$;

create or replace function public.can_manage_ticket_templates()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
      and status = 'active'
  );
$$;

revoke all on function public.can_read_ticket_templates(), public.can_manage_ticket_templates() from public;
grant execute on function public.can_read_ticket_templates(), public.can_manage_ticket_templates() to authenticated;

drop policy if exists "ticket_templates_authorized_read" on public.ticket_templates;
create policy "ticket_templates_authorized_read" on public.ticket_templates
  for select to authenticated using (public.can_read_ticket_templates());

drop policy if exists "ticket_templates_authorized_insert" on public.ticket_templates;
create policy "ticket_templates_authorized_insert" on public.ticket_templates
  for insert to authenticated with check (public.can_manage_ticket_templates());

drop policy if exists "ticket_templates_authorized_update" on public.ticket_templates;
create policy "ticket_templates_authorized_update" on public.ticket_templates
  for update to authenticated using (public.can_manage_ticket_templates()) with check (public.can_manage_ticket_templates());

drop policy if exists "ticket_templates_authorized_delete" on public.ticket_templates;
create policy "ticket_templates_authorized_delete" on public.ticket_templates
  for delete to authenticated using (public.can_manage_ticket_templates());

create or replace function public.touch_ticket_templates_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists touch_ticket_templates_updated_at on public.ticket_templates;
create trigger touch_ticket_templates_updated_at
  before update on public.ticket_templates
  for each row execute function public.touch_ticket_templates_updated_at();

create or replace function public.save_ticket_template(p_data jsonb)
returns public.ticket_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.ticket_templates;
  template_id uuid := nullif(p_data ->> 'id', '')::uuid;
  v_template_key text := nullif(trim(p_data ->> 'template_key'), '');
  template_status text := coalesce(nullif(p_data ->> 'status', ''), 'active');
  template_is_default boolean := coalesce((p_data ->> 'is_default')::boolean, true);
begin
  if not public.can_manage_ticket_templates() then
    raise exception 'No tienes permiso para editar disenos de tickets.';
  end if;
  if v_template_key is null then
    raise exception 'La clave de plantilla es obligatoria.';
  end if;
  if v_template_key not in ('prebill', 'final_bill', 'delivery', 'takeout', 'kitchen') then
    raise exception 'Clave de plantilla invalida.';
  end if;
  if coalesce(p_data -> 'settings' -> 'blocks' ->> 'showQr', 'true')::boolean
    and coalesce(p_data -> 'qr' ->> 'enabled', p_data -> 'settings' -> 'qr' ->> 'enabled', 'false')::boolean
    and nullif(trim(coalesce(p_data -> 'qr' ->> 'url', p_data -> 'settings' -> 'qr' ->> 'url', '')), '') is not null
    and coalesce(p_data -> 'qr' ->> 'url', p_data -> 'settings' -> 'qr' ->> 'url', '') !~* '^https?://'
  then
    raise exception 'La URL del QR debe iniciar con http:// o https://.';
  end if;
  if coalesce(p_data -> 'settings' -> 'blocks' ->> 'showCoupon', 'false')::boolean
    and coalesce(p_data -> 'settings' -> 'coupon' ->> 'enabled', 'false')::boolean
    and nullif(trim(concat(
      coalesce(p_data -> 'settings' -> 'coupon' ->> 'code', ''),
      coalesce(p_data -> 'settings' -> 'coupon' ->> 'description', '')
    )), '') is null
  then
    raise exception 'El cupon requiere codigo o descripcion.';
  end if;

  if template_is_default and template_status = 'active' then
    update public.ticket_templates
    set is_default = false
    where ticket_templates.template_key = v_template_key
      and (template_id is null or id <> template_id)
      and is_default = true
      and status = 'active';
  end if;

  if template_id is null then
    insert into public.ticket_templates (
      template_key, name, description, paper_width, is_default, status, settings, created_by, updated_by
    ) values (
      v_template_key,
      trim(p_data ->> 'name'),
      nullif(trim(p_data ->> 'description'), ''),
      coalesce(nullif(p_data ->> 'paper_width', ''), '80mm'),
      template_is_default,
      template_status,
      coalesce(p_data -> 'settings', '{}'::jsonb),
      auth.uid(),
      auth.uid()
    ) returning * into saved;
  else
    update public.ticket_templates set
      template_key = v_template_key,
      name = trim(p_data ->> 'name'),
      description = nullif(trim(p_data ->> 'description'), ''),
      paper_width = coalesce(nullif(p_data ->> 'paper_width', ''), '80mm'),
      is_default = template_is_default,
      status = template_status,
      settings = coalesce(p_data -> 'settings', '{}'::jsonb)
    where id = template_id
    returning * into saved;
    if saved.id is null then
      raise exception 'La plantilla de ticket no existe.';
    end if;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_ticket_template(jsonb) from public;
grant execute on function public.save_ticket_template(jsonb) to authenticated;

insert into public.ticket_templates (template_key, name, description, paper_width, is_default, status, settings)
select defaults.template_key, defaults.name, defaults.description, '80mm', true, 'active', defaults.settings
from (values
  ('prebill', 'Precuenta default', 'Formato base para precuentas POS', '{}'::jsonb),
  ('final_bill', 'Cuenta final default', 'Formato base para cuenta final POS', '{}'::jsonb),
  ('delivery', 'Delivery default', 'Formato base para pedidos delivery', '{}'::jsonb),
  ('takeout', 'Para llevar default', 'Formato base para pedidos para llevar', '{}'::jsonb)
) as defaults(template_key, name, description, settings)
where not exists (
  select 1
  from public.ticket_templates existing
  where existing.template_key = defaults.template_key
    and existing.is_default = true
    and existing.status = 'active'
);

insert into storage.buckets (id, name, public)
values ('ticket-assets', 'ticket-assets', true)
on conflict (id) do nothing;

drop policy if exists "ticket_assets_public_read" on storage.objects;
create policy "ticket_assets_public_read" on storage.objects
  for select using (bucket_id = 'ticket-assets');

drop policy if exists "ticket_assets_managers_insert" on storage.objects;
create policy "ticket_assets_managers_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'ticket-assets'
    and public.can_manage_ticket_templates()
  );

drop policy if exists "ticket_assets_managers_update" on storage.objects;
create policy "ticket_assets_managers_update" on storage.objects
  for update to authenticated using (
    bucket_id = 'ticket-assets'
    and public.can_manage_ticket_templates()
  ) with check (
    bucket_id = 'ticket-assets'
    and public.can_manage_ticket_templates()
  );

drop policy if exists "ticket_assets_managers_delete" on storage.objects;
create policy "ticket_assets_managers_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'ticket-assets'
    and public.can_manage_ticket_templates()
  );
