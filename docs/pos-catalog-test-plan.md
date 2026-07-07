# Plan de pruebas manuales — Catálogo POS / platillos

Fuente oficial: `public.pos_products` en Supabase.

## Pre-requisitos

1. Aplicar en Supabase SQL Editor (en orden):
   - `supabase/schema/162_pos_catalog_save_refresh_suppression.sql` (si no está aplicado)
   - `supabase/schema/164_pos_catalog_definitive.sql`
2. Variables en `frontend/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
3. DevTools abierto, filtro de consola: `[POS catalog]`

## Diagnóstico inicial (SQL Editor)

```sql
SELECT diagnose_pos_catalog_health();
SELECT id, name, active, length(image_url) AS img_bytes
FROM public.pos_products
ORDER BY created_at DESC
LIMIT 20;
```

Anotar: `total_products`, `products_with_inline_image`, `max_image_url_bytes`.

---

## Prueba 1 — Crear platillo simple sin imagen

1. Ir a `/pos?section=agregar-item`
2. «+ Nuevo platillo» → nombre, categoría, área, precio, activo
3. Guardar

**Esperado:**
- Toast «Producto guardado correctamente»
- Consola: `[POS catalog] save_result` con `ok: true`, `verified: true`
- El platillo aparece en el grid sin refresh

## Prueba 2 — Hard refresh (simple)

1. Hard refresh (Ctrl+Shift+R)
2. Volver a `/pos?section=agregar-item`

**Esperado:**
- El platillo sigue visible
- Consola: `[POS catalog] load_result` con `source: rpc:list_pos_catalog_page`
- **No** aparece mensaje de timeout ni «0 platillos» si hay datos

## Prueba 3 — Crear platillo con imagen

1. Crear platillo con imagen (JPG/PNG)
2. Guardar

**Esperado:**
- Consola `save_attempt` muestra `imageMeta.bytes` (tamaño)
- Grid muestra icono 📷 o imagen si se cargó lazy al editar
- Tras hard refresh el platillo **sigue en la lista** (nombre visible aunque imagen no esté en listado)

## Prueba 4 — Editar y ver imagen

1. Editar el platillo con imagen
2. Confirmar que la imagen carga en el formulario

**Esperado:**
- Consola: `load_result` con `source: detail:pos_products`
- Imagen visible en formulario

## Prueba 5 — Verificación post-save (SQL)

Tras crear un platillo, copiar su `id` de la consola y ejecutar:

```sql
SELECT verify_pos_product_exists('UUID-AQUI'::uuid);
```

**Esperado:** `{"ok": true, ...}`

## Prueba 6 — Timeout / error UX

Si la migración 164 **no** está aplicada, forzar timeout observando el mensaje.

**Esperado:**
- Banner: «No se pudo cargar el catálogo por tiempo de espera…»
- **No** mostrar «No hay platillos» / «0 platillos» como si la tabla estuviera vacía

## Prueba 7 — 100+ productos

Con catálogo grande (o tras importar varios):

**Esperado:**
- Listado carga en &lt; 5 s
- Paginación «Anterior / Siguiente» visible si total &gt; 50
- Contador: «X en esta página · Y total»

## Prueba 8 — Búsqueda server-side

1. Escribir parte del nombre en el buscador
2. Esperar ~400 ms (debounce)

**Esperado:**
- Lista filtrada sin recargar toda la página
- Consola `load_result` con parámetros de búsqueda

## Prueba 9 — Filtro activos / inactivos

1. Desactivar un platillo
2. Filtro «Inactivos»

**Esperado:**
- Platillo aparece en inactivos
- Filtro «Activos» ya no lo muestra

## Prueba 10 — Venta en mesero

1. Ir a `/pos` (sección operación)
2. Confirmar que productos activos aparecen para tomar orden

**Esperado:**
- Catálogo de venta carga (puede tardar más si hay muchos productos con variantes)
- Producto recién creado disponible si está activo y configurado

---

## Prueba 11 — Imagen grande de redes sociales

1. Subir JPG/PNG de varios MB (foto de redes)
2. Observar consola `[POS image]`

**Esperado:**
- `original_size` muestra tamaño original (ej. 4–8 MB)
- `optimized_size` &lt; 300 KB ideal (o cercano tras reintentos)
- `compression_ratio` alto
- Toast/advertencia si original &gt; 5 MB: «La imagen es pesada…»
- Al guardar: `image_url` en Supabase es URL de Storage, **no** `data:image…`

## Prueba 12 — Auditoría SQL de imágenes

```sql
SELECT diagnose_pos_catalog_health();
```

Revisar campos:
- `products_with_inline_image` / `products_with_data_image`
- `max_image_url_bytes`, `avg_image_url_bytes`
- `heaviest_images` (top 20)
- `products_with_storage_image`

**Esperado tras migración 165:** nuevos productos usan `products_with_storage_image`; base64 solo en registros legacy pendientes de re-guardar.

---

## Logs de referencia

| Fase | Prefijo consola | Campos clave |
|------|-----------------|--------------|
| Optimizar | `[POS image]` | `original_size`, `optimized_size`, `compression_ratio` |
| Storage | `[POS image]` | `storage`, `uploaded` |
| Guardar | `save_attempt` | `name`, `imageMeta`, `imageStorage` |
| Guardar OK | `save_result` | `ok`, `verified`, `productId`, `imageUrl` |
| Listar | `load_result` | `source`, `count`, `total`, `ms` |
| Verificar | `verify_result` | `ok`, `source` |

## Criterio de éxito

- Los platillos **persisten** tras hard refresh
- Timeout muestra error explícito, no catálogo vacío falso
- Listado admin paginado sin columnas pesadas (`image_url`, `description`)
- `image_url` guarda URL pública de Storage, no base64 grande
- Imagen visible al editar (carga lazy)
- `npm run build` pasa sin errores
