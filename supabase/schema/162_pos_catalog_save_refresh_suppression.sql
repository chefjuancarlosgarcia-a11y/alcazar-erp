-- Suppress redundant refresh_pos_product_catalog_state during save_pos_catalog_product.
-- Each option group/choice insert was firing refresh (FOR UPDATE + validation) → statement timeout.
-- Apply after 161_pos_configurable_products.sql.

create or replace function public.pos_catalog_refresh_is_suppressed()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('pos.suppress_catalog_refresh', true), '') = 'true';
$$;

create or replace function public.refresh_pos_product_catalog_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.pos_catalog_refresh_is_suppressed() then
    return coalesce(new, old);
  end if;
  perform public.refresh_pos_product_catalog_state(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_pos_product_catalog_state_trigger_option_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := coalesce(new.product_id, old.product_id);
begin
  if public.pos_catalog_refresh_is_suppressed() then
    return coalesce(new, old);
  end if;
  if v_product_id is null then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.pos_products where id = v_product_id) then
    return coalesce(new, old);
  end if;
  perform public.refresh_pos_product_catalog_state(v_product_id);
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_pos_product_catalog_state_trigger_option_choices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  if public.pos_catalog_refresh_is_suppressed() then
    return coalesce(new, old);
  end if;
  select grp.product_id into v_product_id
  from public.pos_option_groups grp
  where grp.id = coalesce(new.group_id, old.group_id);

  if v_product_id is not null
     and exists (select 1 from public.pos_products where id = v_product_id) then
    perform public.refresh_pos_product_catalog_state(v_product_id);
  end if;
  return coalesce(new, old);
end;
$$;

-- save_pos_catalog_product: set suppress flag for bulk child writes; single refresh at end.
create or replace function public.save_pos_catalog_product(
  p_product_id uuid,
  p_product jsonb,
  p_variants jsonb default '[]'::jsonb,
  p_modifiers jsonb default '[]'::jsonb,
  p_option_groups jsonb default '[]'::jsonb
)
returns public.pos_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.pos_products;
  recipe public.standard_recipes;
  variant_row jsonb;
  modifier_row jsonb;
  group_row jsonb;
  choice_row jsonb;
  variant_ids uuid[] := '{}'::uuid[];
  modifier_ids uuid[] := '{}'::uuid[];
  group_ids uuid[] := '{}'::uuid[];
  choice_ids uuid[] := '{}'::uuid[];
  saved_variant_id uuid;
  saved_modifier_id uuid;
  saved_group_id uuid;
  saved_choice_id uuid;
  v_product_type text := coalesce(nullif(trim(p_product ->> 'product_type'), ''), 'simple');
  v_active boolean := coalesce((p_product ->> 'active')::boolean, true);
  v_is_test boolean := coalesce((p_product ->> 'is_test_item')::boolean, false) or v_product_type = 'manual_test';
  v_recipe_id uuid := nullif(p_product ->> 'recipe_id', '')::uuid;
  v_area_id text := nullif(trim(p_product ->> 'production_area_id'), '');
  v_mode text := public.get_inventory_deduction_mode();
  v_recipe_required boolean := coalesce((p_product ->> 'recipe_required_for_sale')::boolean, false);
  v_tracking boolean := coalesce((p_product ->> 'inventory_tracking_enabled')::boolean, false);
  v_selection_mode text;
  v_active_choice_count integer;
begin
  perform set_config('pos.suppress_catalog_refresh', 'true', true);

  if not public.is_profile_manager() then
    raise exception 'No tienes permiso para guardar productos POS.';
  end if;

  if nullif(trim(p_product ->> 'name'), '') is null then
    raise exception 'El nombre del producto POS es obligatorio.';
  end if;

  if v_area_id is null and v_active then
    raise exception 'Selecciona el area de preparacion del producto.';
  end if;

  if v_product_type not in ('pizza', 'simple', 'beverage', 'dessert', 'manual_test', 'configurable') then
    raise exception 'Tipo de producto invalido.';
  end if;

  if v_product_type not in ('pizza', 'configurable') and not v_is_test then
    if v_recipe_id is null and (v_mode = 'strict' or v_recipe_required) then
      raise exception 'El producto necesita una receta conectada.';
    end if;

    if v_recipe_id is not null then
      select * into recipe
      from public.standard_recipes
      where id = v_recipe_id
        and active = true
        and recipe_type = 'final_product';
      if recipe.id is null then
        raise exception 'La receta conectada no es valida.';
      end if;
      if recipe.production_area_id is distinct from v_area_id then
        raise exception 'El area del producto debe coincidir con el area de la receta conectada.';
      end if;
    end if;
  end if;

  if v_product_type = 'configurable' and v_active then
    if jsonb_array_length(coalesce(p_option_groups, '[]'::jsonb)) = 0 then
      raise exception 'Un producto configurable activo requiere al menos un grupo de opciones.';
    end if;

    for group_row in select value from jsonb_array_elements(coalesce(p_option_groups, '[]'::jsonb))
    loop
      if coalesce((group_row ->> 'is_active')::boolean, true) = false then
        continue;
      end if;

      if nullif(trim(group_row ->> 'name'), '') is null then
        raise exception 'Cada grupo activo debe tener nombre.';
      end if;

      v_selection_mode := coalesce(nullif(trim(group_row ->> 'selection_mode'), ''), 'single');
      if v_selection_mode not in ('single', 'multiple') then
        raise exception 'Modo de seleccion invalido en grupo %. ', group_row ->> 'name';
      end if;

      if v_selection_mode = 'single'
         and nullif(group_row ->> 'max_selections', '') is not null
         and (group_row ->> 'max_selections')::integer <> 1 then
        raise exception 'El grupo % con seleccion unica debe tener max_selections = 1.', group_row ->> 'name';
      end if;

      select count(*) into v_active_choice_count
      from jsonb_array_elements(coalesce(group_row -> 'choices', '[]'::jsonb)) choice(value)
      where coalesce((choice.value ->> 'is_active')::boolean, true)
        and nullif(trim(choice.value ->> 'name'), '') is not null;

      if coalesce((group_row ->> 'required')::boolean, false) and v_active_choice_count = 0 then
        raise exception 'El grupo requerido % debe tener al menos una opcion activa.', group_row ->> 'name';
      end if;
    end loop;
  end if;

  if p_product_id is null then
    insert into public.pos_products (
      name, description, price, image_url, category_id, category_name,
      recipe_id, production_area_id, active, is_test_item, product_type,
      allow_kitchen_notes, prep_time_minutes, sort_order,
      inventory_tracking_enabled, recipe_required_for_sale, created_by
    ) values (
      trim(p_product ->> 'name'),
      nullif(trim(p_product ->> 'description'), ''),
      coalesce((p_product ->> 'price')::numeric, 0),
      nullif(trim(p_product ->> 'image_url'), ''),
      nullif(trim(p_product ->> 'category_id'), ''),
      nullif(trim(p_product ->> 'category_name'), ''),
      case when v_product_type in ('pizza', 'configurable') or v_is_test then null else v_recipe_id end,
      v_area_id,
      v_active,
      v_is_test,
      v_product_type,
      coalesce((p_product ->> 'allow_kitchen_notes')::boolean, false),
      coalesce((p_product ->> 'prep_time_minutes')::integer, 15),
      coalesce((p_product ->> 'sort_order')::integer, 0),
      v_tracking,
      v_recipe_required,
      auth.uid()
    )
    returning * into saved;
  else
    update public.pos_products
    set
      name = trim(p_product ->> 'name'),
      description = nullif(trim(p_product ->> 'description'), ''),
      price = coalesce((p_product ->> 'price')::numeric, 0),
      image_url = nullif(trim(p_product ->> 'image_url'), ''),
      category_id = nullif(trim(p_product ->> 'category_id'), ''),
      category_name = nullif(trim(p_product ->> 'category_name'), ''),
      recipe_id = case when v_product_type in ('pizza', 'configurable') or v_is_test then null else v_recipe_id end,
      production_area_id = v_area_id,
      active = v_active,
      is_test_item = v_is_test,
      product_type = v_product_type,
      allow_kitchen_notes = coalesce((p_product ->> 'allow_kitchen_notes')::boolean, false),
      prep_time_minutes = coalesce((p_product ->> 'prep_time_minutes')::integer, 15),
      sort_order = coalesce((p_product ->> 'sort_order')::integer, 0),
      inventory_tracking_enabled = v_tracking,
      recipe_required_for_sale = v_recipe_required
    where id = p_product_id
    returning * into saved;

    if saved.id is null then
      raise exception 'El producto POS seleccionado no existe.';
    end if;
  end if;

  if v_product_type = 'pizza' then
    for variant_row in select value from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb))
    loop
      if nullif(trim(variant_row ->> 'size'), '') is null then
        continue;
      end if;

      saved_variant_id := null;

      if nullif(variant_row ->> 'id', '') is null then
        insert into public.pos_product_variants (
          product_id, name, size, price, recipe_id, prep_time_minutes, is_active, sort_order
        ) values (
          saved.id,
          coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
          trim(variant_row ->> 'size'),
          coalesce((variant_row ->> 'price')::numeric, 0),
          nullif(variant_row ->> 'recipe_id', '')::uuid,
          coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
          coalesce((variant_row ->> 'is_active')::boolean, false),
          coalesce((variant_row ->> 'sort_order')::integer, 0)
        )
        returning id into saved_variant_id;
      else
        update public.pos_product_variants
        set
          name = coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
          size = trim(variant_row ->> 'size'),
          price = coalesce((variant_row ->> 'price')::numeric, 0),
          recipe_id = nullif(variant_row ->> 'recipe_id', '')::uuid,
          prep_time_minutes = coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
          is_active = coalesce((variant_row ->> 'is_active')::boolean, false),
          sort_order = coalesce((variant_row ->> 'sort_order')::integer, 0)
        where id = (variant_row ->> 'id')::uuid
          and product_id = saved.id
        returning id into saved_variant_id;

        if saved_variant_id is null then
          insert into public.pos_product_variants (
            product_id, name, size, price, recipe_id, prep_time_minutes, is_active, sort_order
          ) values (
            saved.id,
            coalesce(nullif(trim(variant_row ->> 'name'), ''), saved.name),
            trim(variant_row ->> 'size'),
            coalesce((variant_row ->> 'price')::numeric, 0),
            nullif(variant_row ->> 'recipe_id', '')::uuid,
            coalesce((variant_row ->> 'prep_time_minutes')::integer, 0),
            coalesce((variant_row ->> 'is_active')::boolean, false),
            coalesce((variant_row ->> 'sort_order')::integer, 0)
          )
          returning id into saved_variant_id;
        end if;
      end if;

      if saved_variant_id is not null then
        variant_ids := array_append(variant_ids, saved_variant_id);
      end if;
    end loop;

    delete from public.pos_product_variants
    where product_id = saved.id
      and (cardinality(variant_ids) = 0 or id <> all(variant_ids));

    update public.pos_products
    set price = coalesce((
      select min(variant.price)
      from public.pos_product_variants variant
      where variant.product_id = saved.id
        and variant.is_active = true
    ), 0)
    where id = saved.id
    returning * into saved;
  else
    delete from public.pos_product_variants
    where product_id = saved.id;
  end if;

  if v_product_type = 'configurable' then
    for group_row in select value from jsonb_array_elements(coalesce(p_option_groups, '[]'::jsonb))
    loop
      if nullif(trim(group_row ->> 'name'), '') is null then
        continue;
      end if;

      saved_group_id := null;
      v_selection_mode := coalesce(nullif(trim(group_row ->> 'selection_mode'), ''), 'single');

      if nullif(group_row ->> 'id', '') is null then
        insert into public.pos_option_groups (
          product_id, name, sort_order, required, selection_mode,
          min_selections, max_selections, is_active
        ) values (
          saved.id,
          trim(group_row ->> 'name'),
          coalesce((group_row ->> 'sort_order')::integer, 0),
          coalesce((group_row ->> 'required')::boolean, false),
          v_selection_mode,
          coalesce((group_row ->> 'min_selections')::integer, case when v_selection_mode = 'single' then 1 else 0 end),
          case
            when v_selection_mode = 'single' then 1
            else nullif(group_row ->> 'max_selections', '')::integer
          end,
          coalesce((group_row ->> 'is_active')::boolean, true)
        )
        returning id into saved_group_id;
      else
        update public.pos_option_groups
        set
          name = trim(group_row ->> 'name'),
          sort_order = coalesce((group_row ->> 'sort_order')::integer, 0),
          required = coalesce((group_row ->> 'required')::boolean, false),
          selection_mode = v_selection_mode,
          min_selections = coalesce((group_row ->> 'min_selections')::integer, case when v_selection_mode = 'single' then 1 else 0 end),
          max_selections = case
            when v_selection_mode = 'single' then 1
            else nullif(group_row ->> 'max_selections', '')::integer
          end,
          is_active = coalesce((group_row ->> 'is_active')::boolean, true)
        where id = (group_row ->> 'id')::uuid
          and product_id = saved.id
        returning id into saved_group_id;

        if saved_group_id is null then
          insert into public.pos_option_groups (
            product_id, name, sort_order, required, selection_mode,
            min_selections, max_selections, is_active
          ) values (
            saved.id,
            trim(group_row ->> 'name'),
            coalesce((group_row ->> 'sort_order')::integer, 0),
            coalesce((group_row ->> 'required')::boolean, false),
            v_selection_mode,
            coalesce((group_row ->> 'min_selections')::integer, case when v_selection_mode = 'single' then 1 else 0 end),
            case
              when v_selection_mode = 'single' then 1
              else nullif(group_row ->> 'max_selections', '')::integer
            end,
            coalesce((group_row ->> 'is_active')::boolean, true)
          )
          returning id into saved_group_id;
        end if;
      end if;

      if saved_group_id is null then
        continue;
      end if;

      group_ids := array_append(group_ids, saved_group_id);

      for choice_row in select value from jsonb_array_elements(coalesce(group_row -> 'choices', '[]'::jsonb))
      loop
        if nullif(trim(choice_row ->> 'name'), '') is null then
          continue;
        end if;

        if coalesce(nullif(trim(choice_row ->> 'price_mode'), ''), 'none') = 'absolute'
           and coalesce((choice_row ->> 'price')::numeric, 0) <= 0
           and coalesce((choice_row ->> 'is_active')::boolean, true) then
          raise exception 'La opcion % del grupo % requiere precio mayor que cero.', choice_row ->> 'name', group_row ->> 'name';
        end if;

        saved_choice_id := null;

        if nullif(choice_row ->> 'id', '') is null then
          insert into public.pos_option_choices (
            group_id, name, sort_order, price_mode, price, recipe_id, is_active
          ) values (
            saved_group_id,
            trim(choice_row ->> 'name'),
            coalesce((choice_row ->> 'sort_order')::integer, 0),
            coalesce(nullif(trim(choice_row ->> 'price_mode'), ''), 'none'),
            coalesce((choice_row ->> 'price')::numeric, 0),
            nullif(choice_row ->> 'recipe_id', '')::uuid,
            coalesce((choice_row ->> 'is_active')::boolean, true)
          )
          returning id into saved_choice_id;
        else
          update public.pos_option_choices
          set
            group_id = saved_group_id,
            name = trim(choice_row ->> 'name'),
            sort_order = coalesce((choice_row ->> 'sort_order')::integer, 0),
            price_mode = coalesce(nullif(trim(choice_row ->> 'price_mode'), ''), 'none'),
            price = coalesce((choice_row ->> 'price')::numeric, 0),
            recipe_id = nullif(choice_row ->> 'recipe_id', '')::uuid,
            is_active = coalesce((choice_row ->> 'is_active')::boolean, true)
          where id = (choice_row ->> 'id')::uuid
          returning id into saved_choice_id;

          if saved_choice_id is null then
            insert into public.pos_option_choices (
              group_id, name, sort_order, price_mode, price, recipe_id, is_active
            ) values (
              saved_group_id,
              trim(choice_row ->> 'name'),
              coalesce((choice_row ->> 'sort_order')::integer, 0),
              coalesce(nullif(trim(choice_row ->> 'price_mode'), ''), 'none'),
              coalesce((choice_row ->> 'price')::numeric, 0),
              nullif(choice_row ->> 'recipe_id', '')::uuid,
              coalesce((choice_row ->> 'is_active')::boolean, true)
            )
            returning id into saved_choice_id;
          end if;
        end if;

        if saved_choice_id is not null then
          choice_ids := array_append(choice_ids, saved_choice_id);
        end if;
      end loop;
    end loop;

    delete from public.pos_option_choices
    where group_id in (
      select id from public.pos_option_groups where product_id = saved.id
    )
    and (cardinality(choice_ids) = 0 or id <> all(choice_ids));

    delete from public.pos_option_groups
    where product_id = saved.id
      and (cardinality(group_ids) = 0 or id <> all(group_ids));

    delete from public.pos_product_modifiers
    where product_id = saved.id;

    update public.pos_products
    set price = public.pos_configurable_min_absolute_price(saved.id)
    where id = saved.id
    returning * into saved;
  else
    delete from public.pos_option_choices
    where group_id in (
      select id from public.pos_option_groups where product_id = saved.id
    );

    delete from public.pos_option_groups
    where product_id = saved.id;
  end if;

  for modifier_row in select value from jsonb_array_elements(coalesce(p_modifiers, '[]'::jsonb))
  loop
    if nullif(trim(modifier_row ->> 'name'), '') is null then
      continue;
    end if;

    saved_modifier_id := null;

    if nullif(modifier_row ->> 'id', '') is null then
      insert into public.pos_product_modifiers (
        product_id, name, modifier_type, price_delta, is_active, sort_order
      ) values (
        saved.id,
        trim(modifier_row ->> 'name'),
        coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
        coalesce((modifier_row ->> 'price_delta')::numeric, 0),
        coalesce((modifier_row ->> 'is_active')::boolean, true),
        coalesce((modifier_row ->> 'sort_order')::integer, 0)
      )
      returning id into saved_modifier_id;
    else
      update public.pos_product_modifiers
      set
        name = trim(modifier_row ->> 'name'),
        modifier_type = coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
        price_delta = coalesce((modifier_row ->> 'price_delta')::numeric, 0),
        is_active = coalesce((modifier_row ->> 'is_active')::boolean, true),
        sort_order = coalesce((modifier_row ->> 'sort_order')::integer, 0)
      where id = (modifier_row ->> 'id')::uuid
        and product_id = saved.id
      returning id into saved_modifier_id;

      if saved_modifier_id is null then
        insert into public.pos_product_modifiers (
          product_id, name, modifier_type, price_delta, is_active, sort_order
        ) values (
          saved.id,
          trim(modifier_row ->> 'name'),
          coalesce(nullif(trim(modifier_row ->> 'modifier_type'), ''), 'remove'),
          coalesce((modifier_row ->> 'price_delta')::numeric, 0),
          coalesce((modifier_row ->> 'is_active')::boolean, true),
          coalesce((modifier_row ->> 'sort_order')::integer, 0)
        )
        returning id into saved_modifier_id;
      end if;
    end if;

    if saved_modifier_id is not null then
      modifier_ids := array_append(modifier_ids, saved_modifier_id);
    end if;
  end loop;

  if v_product_type <> 'configurable' then
    delete from public.pos_product_modifiers
    where product_id = saved.id
      and (cardinality(modifier_ids) = 0 or id <> all(modifier_ids));
  end if;

  delete from public.pos_recipe_links
  where pos_product_id = saved.id::text;

  if saved.recipe_id is not null then
    insert into public.pos_recipe_links (pos_product_id, recipe_id, auto_consume)
    values (saved.id::text, saved.recipe_id, true)
    on conflict (pos_product_id) do update
      set recipe_id = excluded.recipe_id,
          auto_consume = true;
  end if;

  perform set_config('pos.suppress_catalog_refresh', 'false', true);

  select * into saved
  from public.refresh_pos_product_catalog_state(saved.id);

  return saved;
end;
$$;
