# Auditoría local — migraciones 197 y 198 (POS estación)

**Estado:** migraciones **197 y 198 ya aplicadas en remoto** (test **6/6** y **44/44**; postflight **22 wrappers**; flag **false**). **No reaplicar** 197/198 en ese entorno — solo auditoría read-only o migración fix-forward si hay deriva vs repo (`7ecb4b7` en PR #13). Pendiente operativo: merge PR, deploy `main`, verificación, flag y smoke (autorización aparte).

---

## 197 — `197_fix_operational_pin_module_station_type.sql` (~177 líneas)

| Líneas | Contenido | Veredicto |
|--------|-----------|-----------|
| 4–10 | `absolute_expires_at` en `operational_operator_sessions` | OK — tope duro POS 15 min en verify |
| 12–171 | `verify_operational_pin_for_device` reemplazo completo | OK — `v_required_module` desde `station_type`; rechaza `p_module` distinto |
| 47–53 | Mapa cash/pos/kds/production | OK — alinea con RRHH estación |
| 67–71 | Idle POS 120s vs cash 90s | OK — coherente con 198 `station_pos_extend_operator_idle` 120s |
| 63–65 | POS sin `cash_register_id` no exigido | OK |
| 107–123 | Idempotencia PIN reutiliza sesión activa | OK — no reemite token en replay |
| 126–128 | Supersede sesiones previas del dispositivo | OK |
| 151–154 | `absolute_expires_at` solo módulo `pos` | OK |
| 173–176 | REVOKE público + GRANT authenticated | OK |

**Riesgos 197:** ninguno bloqueante; depende de 196/device auth previo.

**Postflight:** `diagnose_operational_pin_module_station_type_postflight_197.sql` (existente).

---

## 198 — `198_operational_station_pos_shared_foundation.sql` (mapa por sección)

Una sola transacción `begin` … `commit`. Modularización documentada en `supabase/schema/parts/198_README.md` (sin partir transacción).

| Sección | ~Líneas | Contenido | Veredicto |
|---------|---------|-----------|-----------|
| Flag | 6–45 | `operational_station_pos_enabled` default false | OK |
| Tablas | 51–99 | Idempotencia + audit | OK — RLS on, grants mínimos |
| Helpers idempotencia | 105–555 | bind, context, audit, extend idle | OK — internals revocados |
| Lock + context + open | 561–833 | Wrappers públicos iniciales | OK — actor operador corregido |
| Owner / release assert | 835–1006 | Helpers estación | OK — L3/L4 supervisor sin PIN |
| **Pricing** | 1011–1245 | `station_pos_compute_line_item_pricing` | **Corregido** — pizza exige variante; mitades usan 1.ª receta opción; modifiers por UUID; nombre con tamaño |
| Producción interna | 1247–1714 | Copia 185 con operador | OK — no toca RPC humano |
| **Plano** | 1719–1820 | `list_station_pos_tables` | **Corregido** — áreas + mesas + settings + órdenes activas |
| Lectura orden/catálogo | 1821–1973 | get order/history/catalog | OK |
| Mutaciones | 1975–2827 | add/update/remove/clear/bill/cashier/release | OK — terminales revocan sesión |
| **Eventos mesa** | nuevo | `get_station_pos_table_events` | **Añadido** |
| Grants | 2831+ | Solo wrappers → authenticated | OK — revisar postflight ACL |

**STATION_POS_PRICING_GAP residual (intencional):**

- Pizza **sin** `p_variant_id` → error (tamaño obligatorio).
- Producto inactivo / modifier UUID inválido / opciones incompletas → errores explícitos.
- No se acepta precio del cliente.

**Frontend acoplado (esta auditoría):**

- `modifierIds` en pizza hacia wrapper (antes solo labels).
- Plano estación consume `areas`/`tables`/`settings` del RPC.

---

## Checklist pre-remoto (staging) — remoto completado

1. ~~Preflight 198~~ — **hecho**
2. ~~Aplicar 197~~ — **hecho** (6/6)
3. ~~Aplicar 198~~ — **hecho** (44/44, 22 wrappers postflight)
4. ~~Postflight 198~~ — **hecho**; flag sigue **false**
5. ~~Tests estructurales~~ — **hecho** en remoto
6. **Pendiente:** smoke staging (tras merge, deploy y autorización de flag)

**Prohibido:** volver a ejecutar los archivos `197_*.sql` / `198_*.sql` de apply en el mismo entorno remoto ya migrado.

---

## Draft PR (sin push remoto hasta autorización)

Título sugerido: `feat: operational station POS shared (197/198, flag off)`

Incluir: diff 197/198, FE `/station/pos`, selftests, runbook, **explicit “do not enable flag in prod”**.
