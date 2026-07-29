# 198 — mapa de modularización (misma transacción)

El archivo `198_operational_station_pos_shared_foundation.sql` debe aplicarse **entero** en un solo `BEGIN … COMMIT`.

Para revisión humana, use este mapa de secciones (aprox. líneas; pueden driftear con edits):

| Part | Líneas aprox. | Objetos |
|------|----------------|---------|
| A — Flag + tablas | 1–99 | settings, idempotency, audit |
| B — Idempotencia/contexto | 100–555 | bind, resolve context, audit helper |
| C — Wrappers base | 556–833 | lock, get_context, open_table |
| D — Autorización estación | 834–1006 | owner, release assert, clear drafts impl |
| E — Pricing | 1007–1245 | `station_pos_compute_line_item_pricing` |
| F — Producción/liberación interna | 1246–1714 | `send_pos_order_to_production_for_operator`, `release_*_for_operator` |
| G — Lecturas públicas | 1715–1973 | list tables, get order, history, catalog |
| H — Mutaciones públicas | 1974–2910 | add item … release |
| I — Grants | 2911–end | ACL authenticated |

**Futuro (opcional):** extraer partes E–F a `\ir parts/198_*.sql` manteniendo un único `198_…_foundation.sql` wrapper; Supabase/psql local soporta `\ir` si el cwd es `supabase/schema`.

**No** crear migraciones 199/200 separadas para wrappers: rompería atomicidad flag+tablas+revokes.
