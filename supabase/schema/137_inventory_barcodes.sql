-- Barcode support for inventory_items (commercial EAN/UPC + internal EGA-INV codes).
-- Apply after 136_inventory_manager_rls_fix.sql.

alter table public.inventory_items
  add column if not exists barcode text,
  add column if not exists barcode_type text default 'CODE128',
  add column if not exists barcode_source text default 'manual',
  add column if not exists barcode_created_at timestamptz;

comment on column public.inventory_items.barcode is
  'Commercial (EAN/UPC) or internal (EGA-INV-XXXXXX) scannable code.';
comment on column public.inventory_items.barcode_type is
  'Symbology hint for rendering/printing: CODE128, EAN13, UPC, EAN8.';
comment on column public.inventory_items.barcode_source is
  'Origin: manual, scan, internal.';
comment on column public.inventory_items.barcode_created_at is
  'When barcode was first assigned to this product.';

create unique index if not exists inventory_items_barcode_unique
  on public.inventory_items (lower(trim(barcode)))
  where barcode is not null and trim(barcode) <> '';

create sequence if not exists public.inventory_internal_barcode_seq
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

create or replace function public.generate_internal_barcode()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_num bigint;
  candidate text;
  attempts int := 0;
begin
  if not public.is_inventory_manager() then
    raise exception 'No tienes permiso para generar códigos internos.';
  end if;

  loop
    next_num := nextval('public.inventory_internal_barcode_seq');
    candidate := 'EGA-INV-' || lpad(next_num::text, 6, '0');

    exit when not exists (
      select 1
      from public.inventory_items
      where lower(trim(barcode)) = lower(candidate)
    );

    attempts := attempts + 1;
    if attempts >= 20 then
      raise exception 'No se pudo generar un código interno único.';
    end if;
  end loop;

  return jsonb_build_object(
    'barcode', candidate,
    'barcode_type', 'CODE128',
    'barcode_source', 'internal'
  );
end;
$$;

revoke all on function public.generate_internal_barcode() from public;
grant execute on function public.generate_internal_barcode() to authenticated;

create or replace function public.find_inventory_item_by_barcode(p_barcode text)
returns setof public.inventory_items
language sql
stable
security invoker
set search_path = ''
as $$
  select i.*
  from public.inventory_items i
  where p_barcode is not null
    and trim(p_barcode) <> ''
    and i.barcode is not null
    and trim(i.barcode) <> ''
    and lower(trim(i.barcode)) = lower(trim(p_barcode))
  order by i.active desc, i.updated_at desc
  limit 1;
$$;

revoke all on function public.find_inventory_item_by_barcode(text) from public;
grant execute on function public.find_inventory_item_by_barcode(text) to authenticated;

-- Backfill sequence from existing internal codes (EGA-INV-XXXXXX).
select setval(
  'public.inventory_internal_barcode_seq',
  greatest(
    coalesce((
      select max(
        nullif(regexp_replace(lower(trim(barcode)), '^ega-inv-', ''), '')::bigint
      )
      from public.inventory_items
      where barcode ~* '^EGA-INV-[0-9]+$'
    ), 0),
    1
  ),
  true
);
