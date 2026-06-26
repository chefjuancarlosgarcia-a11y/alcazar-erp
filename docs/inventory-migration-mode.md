# Modo Migración de Inventario

Permite operar inventario, compras y requisiciones **sin descontar automáticamente** el consumo generado por ventas POS o recetas.

El trigger `protect_inventory_migration_mode_setting` bloqueaba el `INSERT` inicial en SQL Editor (`auth.uid()` es null). La migración 131 ya incluye el fix; si falló a medias, aplicar también `132_inventory_migration_mode_hotfix.sql`.

## Configuración

- **Ubicación:** Configuración → pestaña **Operación** (solo admin)
- **Clave:** `app_settings.inventory_migration_mode`
- **RPCs:** `get_inventory_migration_mode()`, `set_inventory_migration_mode(p_enabled, p_notes)`

## Comportamiento

| Con Modo Migración activo | |
|---|---|
| ✅ Permitido | Inventario, compras, recepciones, requisiciones, ajustes, recetas |
| ❌ Omitido | Descuento automático por `send_pos_order_to_production` y `consume_recipe_inventory` |
| ✅ POS | Sigue enviando a cocina/KDS; no bloquea ventas |

## Prueba manual

1. Aplicar migración 131.
2. Iniciar sesión como **admin**.
3. Ir a **Configuración → Operación** → **Activar Modo Migración**.
4. Verificar banner global en Dashboard, POS, Inventario, etc.
5. En POS, enviar una comanda a producción: debe crear ticket **sin** movimientos `consumption`.
6. Desactivar con **Finalizar Modo Migración** (checkbox de confirmación obligatorio).

## Auditoría

Tabla: `inventory_migration_mode_audit` (solo lectura admin).
