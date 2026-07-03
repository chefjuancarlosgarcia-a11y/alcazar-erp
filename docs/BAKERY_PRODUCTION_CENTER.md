# Centro de Producción de Panadería y Pastelería

MVP operativo para planificar, ejecutar y documentar producción de panadería/pastelería **sin integración POS**.

## Acceso

**Ruta:** `/bakery`

**Roles permitidos:**
- `admin`
- `gerente_general`
- `gerente`
- `supervisor_panaderia`

Ningún otro rol ve el menú ni puede acceder por URL (redirección) ni por RPC/RLS.

### Permisos por rol

| Acción | Admin / Gerencia | Supervisor panadería |
|--------|------------------|----------------------|
| Ver módulo | Sí | Sí |
| Crear/editar plan maestro | Sí | No |
| Iniciar producción desde plan | Sí | Sí |
| Diario del panadero | Sí | Sí |
| Entregar lote (foto obligatoria) | Sí | Sí |
| Gestión de masas | Sí | Sí |
| Registrar merma (foto obligatoria) | Sí | Sí |

## Aplicar en Supabase

Ejecutar en orden:

```
supabase/schema/156_bakery_production_center.sql
supabase/schema/seed_bakery_day1_optional.sql   ← opcional, datos día 1
supabase/schema/test_bakery_mvp_validation.sql  ← validación post-deploy
```

Esto crea:
- Tablas `bakery_*` (prefijo para no colisionar con `production_batches` de producción interna)
- Bucket `bakery-evidence`
- RPCs de lote, entrega, masa y merma
- Rol `supervisor_panaderia` en catálogo

## Flujo operativo (Junior / supervisor)

1. Entrar a **Panadería / Pastelería** → pestaña **Panel supervisor**
2. Ver **¿Qué toca hacer hoy?**
3. Ir a **Plan maestro** → **Realizar producción** en un ítem planificado
4. El sistema crea lote automático (`CHEESECAKE-YYYYMMDD-001`, etc.)
5. Pestaña **Producciones / lotes** → completar **Diario del panadero**
6. **Entregar lote** → cantidad final, calidad y **foto obligatoria**
7. Opcional: **Masas** o **Merma** con evidencia fotográfica

## Flujo gerencia (Andrea)

1. **Plan maestro** → **Crear producción planificada**
2. Definir producto, cantidad, fecha, área destino, prioridad y responsable
3. Vista **diaria** o **semanal** con filtros
4. Seguimiento en panel supervisor y estados del plan

## Validaciones del sistema

- No entregar lote sin foto `delivery`
- No registrar merma sin foto
- No crear lote sin producto
- No entregar sin diario con cantidad real
- Advertencia UI si cantidad real < planificada
- `batch_code` único con correlativo diario por producto

## Integración con inventario

**Pendiente (TODO en RPC `deliver_bakery_production_batch`):**

Cuando el ítem tenga `inventory_item_id` y `destination_area_id`, se puede crear un movimiento `production_output` en `inventory_movements` y actualizar `area_inventory`. La estructura ya existe en producción interna (`038_internal_production.sql`).

## Tablas principales

| Tabla conceptual | Tabla SQL |
|------------------|-----------|
| Plan maestro | `bakery_production_plan_items` |
| Lotes producción | `bakery_production_batches` |
| Diario panadero | `bakery_production_diary_entries` |
| Fotos lote | `bakery_production_batch_photos` |
| Masas | `bakery_dough_batches` |
| Merma | `bakery_waste_records` |

## Recetas

Al iniciar producción, el sistema busca `standard_recipes` activas en áreas `panaderia` / `reposteria` con nombre coincidente al producto planificado.

## Reutilización del ERP

- **Inventario:** catálogo de productos para plan y merma
- **Recetas:** `standard_recipes` precargadas en diario
- **Áreas:** `areas` como destino de entrega
- **Fotos:** bucket `bakery-evidence` (patrón similar a `attendance-evidence`)
- **Roles:** `normalize_profile_role` + RLS + RPC `can_*_bakery_*`

## No duplica

- **Producción interna** (`/inventory?section=produccionInterna`): kardex con insumos; módulo bakery es trazabilidad operativa manual
- **KDS / POS** (`/production`): tickets de comanda, no plan maestro
