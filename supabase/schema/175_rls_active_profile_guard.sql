-- Require active profiles for sensitive authenticated read/write policies.
-- Apply after 174_user_lifecycle_security.sql.

-- Inventory
drop policy if exists "inventory_items_read_active" on public.inventory_items;
create policy "inventory_items_read_active"
  on public.inventory_items for select to authenticated
  using (active = true and public.is_current_profile_active());

drop policy if exists "area_inventory_authenticated_read" on public.area_inventory;
create policy "area_inventory_authenticated_read"
  on public.area_inventory for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_movements_authenticated_read" on public.inventory_movements;
create policy "inventory_movements_authenticated_read"
  on public.inventory_movements for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_item_barcode_aliases_read" on public.inventory_item_barcode_aliases;
create policy "inventory_item_barcode_aliases_read"
  on public.inventory_item_barcode_aliases for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_item_merge_audit_read" on public.inventory_item_merge_audit;
create policy "inventory_item_merge_audit_read"
  on public.inventory_item_merge_audit for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_duplicate_ignore_read" on public.inventory_duplicate_ignore;
create policy "inventory_duplicate_ignore_read"
  on public.inventory_duplicate_ignore for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_item_unit_conversions_read" on public.inventory_item_unit_conversions;
create policy "inventory_item_unit_conversions_read"
  on public.inventory_item_unit_conversions for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "inventory_unit_conversions_authenticated_read" on public.inventory_unit_conversions;
create policy "inventory_unit_conversions_authenticated_read"
  on public.inventory_unit_conversions for select to authenticated
  using (public.is_current_profile_active());

-- Requisitions
drop policy if exists "requisitions_authenticated_read" on public.requisitions;
create policy "requisitions_authenticated_read"
  on public.requisitions for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "requisition_items_authenticated_read" on public.requisition_items;
create policy "requisition_items_authenticated_read"
  on public.requisition_items for select to authenticated
  using (public.is_current_profile_active());

-- POS orders
drop policy if exists "pos_orders_authenticated_read" on public.pos_orders;
create policy "pos_orders_authenticated_read"
  on public.pos_orders for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_order_items_authenticated_read" on public.pos_order_items;
create policy "pos_order_items_authenticated_read"
  on public.pos_order_items for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_order_events_authenticated_read" on public.pos_order_events;
create policy "pos_order_events_authenticated_read"
  on public.pos_order_events for select to authenticated
  using (public.is_current_profile_active());

-- POS products
drop policy if exists "pos_products_authenticated_read" on public.pos_products;
create policy "pos_products_authenticated_read"
  on public.pos_products for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_product_variants_authenticated_read" on public.pos_product_variants;
create policy "pos_product_variants_authenticated_read"
  on public.pos_product_variants for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_product_modifiers_authenticated_read" on public.pos_product_modifiers;
create policy "pos_product_modifiers_authenticated_read"
  on public.pos_product_modifiers for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_option_groups_authenticated_read" on public.pos_option_groups;
create policy "pos_option_groups_authenticated_read"
  on public.pos_option_groups for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_option_choices_authenticated_read" on public.pos_option_choices;
create policy "pos_option_choices_authenticated_read"
  on public.pos_option_choices for select to authenticated
  using (public.is_current_profile_active());

-- Production tickets (KDS)
drop policy if exists "production_tickets_authenticated_read" on public.production_tickets;
create policy "production_tickets_authenticated_read"
  on public.production_tickets for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "production_ticket_items_authenticated_read" on public.production_ticket_items;
create policy "production_ticket_items_authenticated_read"
  on public.production_ticket_items for select to authenticated
  using (public.is_current_profile_active());

-- Recipes
drop policy if exists "recipes_authenticated_read_active" on public.standard_recipes;
create policy "recipes_authenticated_read_active"
  on public.standard_recipes for select to authenticated
  using (active = true and public.is_current_profile_active());

drop policy if exists "recipe_ingredients_authenticated_read" on public.recipe_ingredients;
create policy "recipe_ingredients_authenticated_read"
  on public.recipe_ingredients for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_recipe_links_authenticated_read" on public.pos_recipe_links;
create policy "pos_recipe_links_authenticated_read"
  on public.pos_recipe_links for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "pos_recipe_consumptions_authenticated_read" on public.pos_recipe_consumptions;
create policy "pos_recipe_consumptions_authenticated_read"
  on public.pos_recipe_consumptions for select to authenticated
  using (public.is_current_profile_active());

-- Yield / costing audits
drop policy if exists "inventory_yield_profiles_read" on public.inventory_yield_profiles;
create policy "inventory_yield_profiles_read"
  on public.inventory_yield_profiles for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "yield_waste_reasons_read" on public.yield_waste_reasons;
create policy "yield_waste_reasons_read"
  on public.yield_waste_reasons for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "yield_audit_campaigns_read" on public.yield_audit_campaigns;
create policy "yield_audit_campaigns_read"
  on public.yield_audit_campaigns for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "yield_audit_campaign_items_read" on public.yield_audit_campaign_items;
create policy "yield_audit_campaign_items_read"
  on public.yield_audit_campaign_items for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "yield_audits_read" on public.yield_audits;
create policy "yield_audits_read"
  on public.yield_audits for select to authenticated
  using (public.is_current_profile_active());

drop policy if exists "yield_audits_insert" on public.yield_audits;
create policy "yield_audits_insert"
  on public.yield_audits for insert to authenticated
  with check (public.is_current_profile_active());

drop policy if exists "recipe_cost_history_read" on public.recipe_cost_history;
create policy "recipe_cost_history_read"
  on public.recipe_cost_history for select to authenticated
  using (public.is_current_profile_active());

-- App settings (theme/config reads)
drop policy if exists "app_settings_read_authenticated" on public.app_settings;
create policy "app_settings_read_authenticated"
  on public.app_settings for select to authenticated
  using (public.is_current_profile_active());
