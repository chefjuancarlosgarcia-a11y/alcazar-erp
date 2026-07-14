-- Diagnóstico: comparar borrador duplicado vs borrador manual y simular validaciones de submit.
-- Ejecutar en Supabase SQL Editor (producción) y revisar todas las filas del resultado.

-- ---------------------------------------------------------------------------
-- 1) Par de requisiciones: último borrador duplicado vs último borrador manual
-- ---------------------------------------------------------------------------
with duplicate_draft as (
  select r.*
  from public.requisitions r
  where r.status = 'draft'
    and r.creation_source in ('duplicate_full', 'duplicate_pending', 'template_requisition')
  order by r.created_at desc
  limit 1
),
manual_draft as (
  select r.*
  from public.requisitions r
  where r.status = 'draft'
    and coalesce(r.creation_source, 'manual') = 'manual'
  order by r.created_at desc
  limit 1
)
select
  'requisitions_header' as section,
  d.id as duplicate_id,
  d.requisition_number as duplicate_number,
  m.id as manual_id,
  m.requisition_number as manual_number,
  jsonb_build_object(
    'duplicate', jsonb_build_object(
      'status', d.status,
      'creation_source', d.creation_source,
      'source_requisition_id', d.source_requisition_id,
      'generation_mode', d.generation_mode,
      'generated_at', d.generated_at,
      'generated_by', d.generated_by,
      'requested_by', d.requested_by,
      'requested_by_profile_id', d.requested_by_profile_id,
      'from_area_id', d.from_area_id,
      'to_area_id', d.to_area_id,
      'submitted_at', d.submitted_at,
      'created_at', d.created_at,
      'updated_at', d.updated_at
    ),
    'manual', jsonb_build_object(
      'status', m.status,
      'creation_source', m.creation_source,
      'source_requisition_id', m.source_requisition_id,
      'generation_mode', m.generation_mode,
      'generated_at', m.generated_at,
      'generated_by', m.generated_by,
      'requested_by', m.requested_by,
      'requested_by_profile_id', m.requested_by_profile_id,
      'from_area_id', m.from_area_id,
      'to_area_id', m.to_area_id,
      'submitted_at', m.submitted_at,
      'created_at', m.created_at,
      'updated_at', m.updated_at
    ),
    'header_diff_keys', (
      select coalesce(jsonb_agg(key), '[]'::jsonb)
      from (
        select key
        from jsonb_each(to_jsonb(d)) dd
        full outer join jsonb_each(to_jsonb(m)) mm using (key)
        where key not in ('id', 'requisition_number', 'notes', 'created_at', 'updated_at', 'generated_at')
          and coalesce(dd.value, 'null'::jsonb) is distinct from coalesce(mm.value, 'null'::jsonb)
      ) diff
    )
  ) as comparison
from duplicate_draft d
full join manual_draft m on true;

-- ---------------------------------------------------------------------------
-- 2) Items: todas las columnas relevantes, lado a lado por ordinal
-- ---------------------------------------------------------------------------
with duplicate_draft as (
  select id from public.requisitions
  where status = 'draft'
    and creation_source in ('duplicate_full', 'duplicate_pending', 'template_requisition')
  order by created_at desc
  limit 1
),
manual_draft as (
  select id from public.requisitions
  where status = 'draft'
    and coalesce(creation_source, 'manual') = 'manual'
  order by created_at desc
  limit 1
),
dup_items as (
  select row_number() over (order by ri.created_at, ri.id) as line_no, ri.*
  from public.requisition_items ri
  join duplicate_draft d on d.id = ri.requisition_id
),
man_items as (
  select row_number() over (order by ri.created_at, ri.id) as line_no, ri.*
  from public.requisition_items ri
  join manual_draft m on m.id = ri.requisition_id
)
select
  coalesce(di.line_no, mi.line_no) as line_no,
  di.item_name as duplicate_item,
  mi.item_name as manual_item,
  jsonb_build_object(
    'duplicate', jsonb_build_object(
      'item_id', di.item_id,
      'requested_quantity', di.requested_quantity,
      'requested_unit', di.requested_unit,
      'unit', di.unit,
      'conversion_factor', di.conversion_factor,
      'converted_requested_quantity', di.converted_requested_quantity,
      'inventory_base_unit_at_request', di.inventory_base_unit_at_request,
      'availability_status', di.availability_status,
      'conversion_warning', di.conversion_warning,
      'approved_quantity', di.approved_quantity,
      'delivered_quantity', di.delivered_quantity,
      'created_at', di.created_at,
      'updated_at', di.updated_at
    ),
    'manual', jsonb_build_object(
      'item_id', mi.item_id,
      'requested_quantity', mi.requested_quantity,
      'requested_unit', mi.requested_unit,
      'unit', mi.unit,
      'conversion_factor', mi.conversion_factor,
      'converted_requested_quantity', mi.converted_requested_quantity,
      'inventory_base_unit_at_request', mi.inventory_base_unit_at_request,
      'availability_status', mi.availability_status,
      'conversion_warning', mi.conversion_warning,
      'approved_quantity', mi.approved_quantity,
      'delivered_quantity', mi.delivered_quantity,
      'created_at', mi.created_at,
      'updated_at', mi.updated_at
    )
  ) as line_comparison,
  (
    select coalesce(jsonb_agg(col), '[]'::jsonb)
    from (
      select col
      from (values
        ('requested_quantity'),
        ('requested_unit'),
        ('unit'),
        ('conversion_factor'),
        ('converted_requested_quantity'),
        ('inventory_base_unit_at_request'),
        ('availability_status'),
        ('conversion_warning'),
        ('approved_quantity'),
        ('delivered_quantity')
      ) as cols(col)
      where
        (col = 'requested_quantity' and di.requested_quantity is distinct from mi.requested_quantity)
        or (col = 'requested_unit' and di.requested_unit is distinct from mi.requested_unit)
        or (col = 'unit' and di.unit is distinct from mi.unit)
        or (col = 'conversion_factor' and di.conversion_factor is distinct from mi.conversion_factor)
        or (col = 'converted_requested_quantity' and di.converted_requested_quantity is distinct from mi.converted_requested_quantity)
        or (col = 'inventory_base_unit_at_request' and di.inventory_base_unit_at_request is distinct from mi.inventory_base_unit_at_request)
        or (col = 'availability_status' and di.availability_status is distinct from mi.availability_status)
        or (col = 'conversion_warning' and di.conversion_warning is distinct from mi.conversion_warning)
        or (col = 'approved_quantity' and di.approved_quantity is distinct from mi.approved_quantity)
        or (col = 'delivered_quantity' and di.delivered_quantity is distinct from mi.delivered_quantity)
    ) diff_cols
  ) as differing_columns
from dup_items di
full join man_items mi on mi.line_no = di.line_no
order by line_no;

-- ---------------------------------------------------------------------------
-- 3) Simular validación de submit_requisition (146+) por línea
-- ---------------------------------------------------------------------------
with duplicate_draft as (
  select id, requisition_number from public.requisitions
  where status = 'draft'
    and creation_source in ('duplicate_full', 'duplicate_pending', 'template_requisition')
  order by created_at desc
  limit 1
)
select
  d.requisition_number,
  ri.id as item_row_id,
  ri.item_name,
  ri.requested_unit,
  ri.unit,
  ri.conversion_factor,
  ri.conversion_warning,
  ri.inventory_base_unit_at_request,
  case
    when coalesce(ri.conversion_warning, false) then 'SKIP (conversion_warning=true)'
    when ri.requested_quantity is null or ri.requested_quantity <= 0 then 'BLOCK: requested_quantity invalida'
    when coalesce(nullif(trim(ri.requested_unit), ''), ri.unit) is null then 'BLOCK: requested_unit nula'
    when ri.conversion_factor is null or ri.conversion_factor <= 0 then 'BLOCK: conversion_factor nulo o <= 0'
    when ri.converted_requested_quantity is null then 'WARN: converted_requested_quantity NULL'
    when ri.inventory_base_unit_at_request is null then 'WARN: inventory_base_unit_at_request NULL'
    else 'OK'
  end as submit_precheck,
  (
    select case
      when public.has_item_requisition_unit_conversion(
        ri.item_id,
        coalesce(nullif(trim(ri.requested_unit), ''), ri.unit)
      ) then 'resolve_item_requisition_unit_factor OK'
      else 'BLOCK: resolve_item_requisition_unit_factor fallaria'
    end
  ) as submit_conversion_check
from duplicate_draft d
join public.requisition_items ri on ri.requisition_id = d.id
order by ri.created_at;

-- ---------------------------------------------------------------------------
-- 4) NULLs obligatorios en borradores duplicados recientes
-- ---------------------------------------------------------------------------
select
  r.requisition_number,
  r.creation_source,
  r.status,
  ri.item_name,
  ri.requested_quantity,
  ri.requested_unit,
  ri.conversion_factor,
  ri.converted_requested_quantity,
  ri.inventory_base_unit_at_request,
  ri.availability_status,
  ri.conversion_warning
from public.requisitions r
join public.requisition_items ri on ri.requisition_id = r.id
where r.status = 'draft'
  and r.creation_source in ('duplicate_full', 'duplicate_pending', 'template_requisition')
  and (
    ri.requested_quantity is null
    or ri.requested_quantity <= 0
    or coalesce(nullif(trim(ri.requested_unit), ''), ri.unit) is null
    or ri.conversion_factor is null
    or ri.conversion_factor <= 0
    or ri.converted_requested_quantity is null
    or ri.inventory_base_unit_at_request is null
    or ri.availability_status is null
  )
order by r.created_at desc, ri.created_at
limit 50;
