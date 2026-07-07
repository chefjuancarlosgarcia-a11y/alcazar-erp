-- POS product images: Supabase Storage bucket + enhanced image diagnostics.
-- Apply after 164_pos_catalog_definitive.sql.

-- ---------------------------------------------------------------------------
-- Storage bucket (public read, managers write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pos-product-images',
  'pos-product-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pos_product_images_public_read" on storage.objects;
create policy "pos_product_images_public_read"
  on storage.objects for select to public
  using (bucket_id = 'pos-product-images');

drop policy if exists "pos_product_images_managers_insert" on storage.objects;
create policy "pos_product_images_managers_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pos-product-images'
    and public.is_profile_manager()
  );

drop policy if exists "pos_product_images_managers_update" on storage.objects;
create policy "pos_product_images_managers_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'pos-product-images' and public.is_profile_manager())
  with check (bucket_id = 'pos-product-images' and public.is_profile_manager());

drop policy if exists "pos_product_images_managers_delete" on storage.objects;
create policy "pos_product_images_managers_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pos-product-images' and public.is_profile_manager());

-- ---------------------------------------------------------------------------
-- Enhanced diagnostics for image_url audit
-- ---------------------------------------------------------------------------
create or replace function public.diagnose_pos_catalog_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total_products', (select count(*)::int from public.pos_products),
    'active_products', (select count(*)::int from public.pos_products where active = true),
    'products_with_image', (
      select count(*)::int from public.pos_products
      where image_url is not null and btrim(image_url) <> ''
    ),
    'products_with_inline_image', (
      select count(*)::int from public.pos_products where image_url like 'data:%'
    ),
    'products_with_data_image', (
      select count(*)::int from public.pos_products where image_url like 'data:image%'
    ),
    'products_with_http_image', (
      select count(*)::int from public.pos_products
      where image_url like 'http://%' or image_url like 'https://%'
    ),
    'products_with_storage_image', (
      select count(*)::int from public.pos_products
      where image_url like '%/storage/v1/object/public/pos-product-images/%'
    ),
    'max_image_url_bytes', (
      select coalesce(max(length(coalesce(image_url, ''))), 0)::int from public.pos_products
    ),
    'avg_image_url_bytes', (
      select coalesce(avg(length(image_url)), 0)::int
      from public.pos_products
      where image_url is not null and btrim(image_url) <> ''
    ),
    'avg_heavy_column_bytes', (
      select coalesce(avg(
        length(coalesce(name, ''))
        + length(coalesce(description, ''))
        + length(coalesce(image_url, ''))
      ), 0)::int
      from public.pos_products
    ),
    'heaviest_images', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'name', h.name,
        'active', h.active,
        'image_url_bytes', h.image_bytes,
        'is_base64', h.is_base64,
        'is_storage_url', h.is_storage_url,
        'is_http_url', h.is_http_url,
        'preview', left(coalesce(h.image_url, ''), 80)
      ) order by h.image_bytes desc), '[]'::jsonb)
      from (
        select
          id,
          name,
          active,
          image_url,
          length(coalesce(image_url, '')) as image_bytes,
          image_url like 'data:%' as is_base64,
          image_url like '%/storage/v1/object/public/pos-product-images/%' as is_storage_url,
          image_url like 'http://%' or image_url like 'https://%' as is_http_url
        from public.pos_products
        where image_url is not null and btrim(image_url) <> ''
        order by length(coalesce(image_url, '')) desc
        limit 20
      ) h
    ),
    'recent_products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'active', r.active,
        'product_type', r.product_type,
        'created_at', r.created_at,
        'image_url_bytes', length(coalesce(r.image_url, '')),
        'has_base64_image', r.image_url like 'data:%',
        'has_storage_image', r.image_url like '%/storage/v1/object/public/pos-product-images/%'
      ) order by r.created_at desc), '[]'::jsonb)
      from (
        select id, name, active, product_type, created_at, image_url
        from public.pos_products
        order by created_at desc
        limit 20
      ) r
    ),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', indexname,
        'definition', indexdef
      ) order by indexname), '[]'::jsonb)
      from pg_indexes
      where schemaname = 'public' and tablename = 'pos_products'
    ),
    'rls_policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', policyname,
        'cmd', cmd,
        'roles', roles
      ) order by policyname), '[]'::jsonb)
      from pg_policies
      where schemaname = 'public' and tablename = 'pos_products'
    ),
    'triggers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', trigger_name,
        'timing', action_timing,
        'event', event_manipulation
      ) order by trigger_name), '[]'::jsonb)
      from information_schema.triggers
      where event_object_schema = 'public' and event_object_table = 'pos_products'
    )
  );
$$;

-- Reject inline base64 in image_url (Storage URL or http(s) only).
create or replace function public.validate_pos_product_image_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.image_url is not null and btrim(new.image_url) <> '' and new.image_url like 'data:%' then
    raise exception 'image_url no puede ser base64 inline. Sube la imagen a Supabase Storage (bucket pos-product-images).';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_pos_product_image_url on public.pos_products;
create trigger validate_pos_product_image_url
  before insert or update of image_url on public.pos_products
  for each row execute function public.validate_pos_product_image_url();
