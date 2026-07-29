# Matriz pricing — POS humano vs estación (198)

Auditoría local. No inventar reglas: fuentes citadas en código.

| Tipo | Regla humana actual | Fuente precio humano | Regla SQL estación |
|------|---------------------|----------------------|-------------------|
| Producto simple | `precio` / `price` del producto; receta y área del producto | `posOrdersService.addItemToOrder` + catálogo | `station_pos_compute_line_item_pricing`: base `pos_products.price` |
| Pizza | **Tamaño obligatorio** (variante activa); precio = variante + Σ modifiers | `POS.jsx` `confirmarAgregarItem` + variantes | Variante requerida (`STATION_POS_PRICING_GAP` si falta); base `pos_product_variants.price` + `price_delta` modifiers |
| Pizza mitad y mitad | **No implementada** en POS humano (comentario FUTURE en `posConfigurableProduct.js`) | N/A | N/A — usar producto `configurable` con option groups cuando exista en catálogo |
| Configurable / mitades (alitas, etc.) | `computeConfigurableUnitPrice`: absolute sum o base+delta; validación grupos | `posConfigurableProduct.js` | Misma lógica en SQL: `price_mode` absolute/delta; 1.ª receta de opción si hay varias (como FE `find recipe_id`) |
| Variante pizza | Solo variantes activas del producto | `pos_product_variants` | Valida `product_id` + `is_active` |
| Modificador | Solo IDs del producto; suma `price_delta` | `getActiveProductModifiers` + keys | JSON array UUID → `pos_product_modifiers` |
| Option choice | Pertenece a group→product; single/multiple según grupo | `validateConfigurableSaleSelections` | min/max/required en SQL |
| Cliente envía unit_price | Ignorado en estación (wrapper no lo recibe) | N/A | Solo IDs/selecciones en `add_station_pos_order_item` |
| Combinación inválida | Error UI | N/A | Excepciones explícitas (no fallback de precio) |

**STATION_POS_PRICING_GAP restante (intencional):**

- Pizza sin `p_variant_id` (sin tamaño).

**No representable hoy:**

- Pizza “mitad y mitad” como tipo `pizza` sin schema dedicado (humano tampoco lo vende así).
