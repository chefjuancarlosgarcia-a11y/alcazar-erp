# Reporte de auditoría de rendimiento — Catálogo POS

**Fecha:** 2026-07-06  
**Objetivo RPC:** `list_pos_catalog_page` &lt; **300 ms**  
**Error prohibido:** `canceling statement due to statement timeout`

---

## 1. Comparación antes / después

| Métrica | Antes (bug) | Después (diseño actual) |
|---------|-------------|-------------------------|
| Listado | `SELECT *` + joins + `image_url` base64 | RPC paginado **sin** `image_url` ni `description` |
| Tamaño payload página 50 | MB (base64 en filas) | ~15–80 KB JSON típico |
| Imágenes en grid | Todas en `<img src=data:…>` | Solo placeholder 📷; **0** requests Storage |
| Imágenes al editar | Ya cargadas en memoria | Lazy: `get_pos_product_image_url` (1 URL) |
| Timeout observado | Sí, en producción | Debe ser **0** con migraciones 164+165 |
| Paginación | No (todo el catálogo) | 50 filas por página |

**Causa raíz histórica:** no era pérdida de datos; era **lectura** de columnas pesadas (`image_url` base64 3–10 MB × N productos).

---

## 2. Protocolo de prueba (150+ productos)

### Pre-requisitos
1. Migraciones aplicadas: `164_pos_catalog_definitive.sql`, `165_pos_product_images_storage.sql`
2. DevTools → Console → filtro `[POS PERF]`
3. DevTools → Network → filtro `list_pos_catalog_page` y `pos-product-images`

### Carga de datos
| Lote | Acción |
|------|--------|
| Lote A | Crear **50** platillos con imagen (foto redes, el sistema optimiza) |
| Lote B | Crear **50** más con imagen |
| Lote C | Llegar a **≥150** total (activos + inactivos) |

Tras cada lote: hard refresh en `/pos?section=agregar-item` y anotar muestra `[POS PERF]`.

### Auditoría automática en navegador (logueado)
```javascript
await window.runPOSCatalogPerfAudit({ pages: [1, 2, 3] })
copy(window.exportPOSCatalogPerfLog())
```

### Auditoría RPC desde terminal
```bash
# Opcional: credenciales de manager
set POS_PERF_EMAIL=admin@alcazar.local
set POS_PERF_PASSWORD=***
node scripts/pos-catalog-perf-benchmark.mjs
```

### SQL (SQL Editor)
Ejecutar `supabase/schema/166_pos_catalog_perf_explain.sql` y pegar salida en sección 5.

---

## 3. Campos registrados `[POS PERF]`

| Campo | Descripción |
|-------|-------------|
| `catalog_size` | Total productos (RPC `total`) |
| `rpc_ms` | Tiempo respuesta RPC / REST |
| `render_ms` | Tiempo hasta paint del grid |
| `payload_bytes` | Tamaño JSON de respuesta |
| `images_loaded` | `<img>` visibles en `.pos-dish-manager` |
| `image_network_requests` | Requests a `pos-product-images` en ventana 3–4 s |
| `request_count` | Recursos nuevos en Performance API |
| `memory_usage` | `usedJSHeapSize` MB (Chrome) |

**Fases:** `catalog_list_rpc` → `catalog_render` → (al editar) `product_image_lazy`

---

## 4. Validación Network (checklist)

En listado del catálogo (sin abrir editor):

- [ ] Hay request a `rpc/list_pos_catalog_page` (~50 items)
- [ ] **No** hay requests a `/storage/v1/object/public/pos-product-images/` por cada tarjeta
- [ ] **No** hay respuestas con `data:image` en el payload del listado
- [ ] `payload_bytes` &lt; 200 KB por página típica

Al abrir **Editar** en un platillo con imagen:

- [ ] 1 request `get_pos_product_image_url` o URL Storage
- [ ] `images_loaded` sube a 1 en el formulario
- [ ] `payload_bytes` de imagen = longitud URL (~200 B) o tamaño archivo optimizado (&lt;300 KB), no MB de base64

---

## 5. EXPLAIN ANALYZE — plantilla de resultados

Pegar aquí la salida de:

```sql
explain (analyze, buffers, format text)
select public.list_pos_catalog_page(50, 0, null, null, null);
```

| Métrica plan | Valor medido | Objetivo |
|--------------|--------------|----------|
| Execution Time | _pendiente_ ms | &lt; 300 ms |
| Planning Time | _pendiente_ ms | &lt; 10 ms |
| Buffers shared hit | _pendiente_ | Alto hit ratio |
| Seq Scan en pos_products | _pendiente_ | Evitar en &gt;150 filas si posible |

**JSON plan:** pegar resultado de `explain (analyze, buffers, format json) select public.list_pos_catalog_page(...)`.

---

## 6. diagnose_pos_catalog_health — plantilla

```sql
select
  (d->>'total_products')::int,
  (d->>'products_with_inline_image')::int,
  (d->>'products_with_storage_image')::int,
  (d->>'products_with_data_image')::int,
  (d->>'max_image_url_bytes')::int,
  (d->>'avg_image_url_bytes')::int
from (select diagnose_pos_catalog_health() d) s;
```

| Campo | Antes (estimado) | Después (objetivo) |
|-------|------------------|---------------------|
| `products_with_inline_image` | &gt; 0 | **0** en productos nuevos |
| `products_with_storage_image` | 0 | **≈ productos con foto** |
| `max_image_url_bytes` | millones | **&lt; 500** (solo URL) |
| `avg_image_url_bytes` | cientos de KB+ | **&lt; 300** |

---

## 7. Muestras de rendimiento (rellenar tras prueba)

### Página 1 (offset 0)
| catalog_size | rpc_ms | render_ms | payload_bytes | images_loaded | memory_usage |
|--------------|--------|-----------|---------------|---------------|--------------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | **0** | _TBD_ |

### Página 2 (offset 50)
| catalog_size | rpc_ms | render_ms | payload_bytes | images_loaded | memory_usage |
|--------------|--------|-----------|---------------|---------------|--------------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | **0** | _TBD_ |

### Página 3 (offset 100)
| catalog_size | rpc_ms | render_ms | payload_bytes | images_loaded | memory_usage |
|--------------|--------|-----------|---------------|---------------|--------------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ | **0** | _TBD_ |

### Al editar 1 platillo con imagen
| rpc_ms (image) | payload_bytes | is_inline |
|----------------|---------------|-----------|
| _TBD_ | _TBD_ | **false** |

---

## 8. Cuellos de botella conocidos y mitigación

| Cuello de botella | Síntoma | Mitigación implementada |
|-------------------|---------|-------------------------|
| `image_url` base64 en tabla | Timeout, MB por fila | Storage + compresión cliente |
| `SELECT *` listado | Payload enorme | RPC sin columnas pesadas |
| Carga venta mesero | Variantes/modifiers en chunks | `IN_CHUNK_SIZE=80`, columnas livianas |
| Legacy base64 existente | `max_image_url_bytes` alto | Re-guardar platillo → migra a Storage |
| Índices | Seq scan lento | Índices en 164 (`active`, `name`, `created_at`) |

---

## 9. Recomendaciones

1. **Aplicar 164+165** si no están en producción — sin esto no hay benchmark válido.
2. **Migrar legacy:** platillos con `products_with_inline_image > 0` → editar y guardar.
3. **Monitoreo:** alerta si `[POS PERF] timeout: true` o `rpc_ms > 500`.
4. **Límite producción:** mantener listado en 50/página; no reintroducir `image_url` en list RPC.
5. **Futuro:** CDN delante de bucket `pos-product-images` si tráfico de edición crece.

---

## 10. Investigación si aparece timeout

1. Copiar línea exacta `[POS PERF]` con `phase: catalog_list_rpc_error` o `timeout_detected`.
2. Identificar `source`: `rpc:list_pos_catalog_page` vs `rest:pos_products` vs `sale_products`.
3. Ejecutar EXPLAIN ANALYZE de la consulta correspondiente (166).
4. Revisar `diagnose_pos_catalog_health().heaviest_images`.
5. Confirmar que no se revirtió el frontend a listado sin paginación.

---

## 11. Criterio de éxito definitivo

- [ ] ≥150 productos en `total_products`
- [ ] `rpc_ms` promedio &lt; 300 ms en 3 páginas
- [ ] `images_loaded = 0` en listado
- [ ] `image_network_requests = 0` en listado
- [ ] Imagen solo al editar
- [ ] `products_with_inline_image` no crece en productos nuevos
- [ ] **Cero** `canceling statement due to statement timeout` en 10 cargas consecutivas
