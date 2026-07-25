# F0A — Snapshot preproducción (plantilla)

## §A — SQL read-only (ejecutar en SQL Editor antes de migrar)

Copiar salida a archivo externo (fuera de Git). No incluir nombres completos si no son necesarios.

```sql
-- --- Estado migración 184 ---
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'pos_orders'
    and column_name = 'owner_profile_id'
) as has_owner_profile_id;

select exists (
  select 1 from pg_constraint where conname = 'pos_orders_owner_profile_id_fkey'
) as has_owner_fk;

select coalesce(string_agg(tgname, ', ' order by tgname), '') as f0a_triggers
from pg_trigger
where tgrelid = 'public.pos_orders'::regclass
  and tgname in ('sync_pos_order_owner_legacy', 'guard_pos_order_owner_columns')
  and not tgisinternal;

select exists (
  select 1 where pg_get_functiondef('public.get_waiter_sales_ranking(date, boolean)'::regprocedure)
    ilike '%coalesce(o.owner_profile_id, o.waiter_id)%'
) as ranking_uses_owner_coalesce;

select exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'diagnose_pos_order_owner_integrity'
) as has_diagnose_integrity;

-- --- Snapshot conteos (validación A) ---
select count(*) as total_orders from public.pos_orders;

select status, count(*) as cnt
from public.pos_orders group by 1 order by 1;

select coalesce(sum(total), 0) as sum_total_paid
from public.pos_orders where status = 'paid';

select count(*) as waiter_id_null from public.pos_orders where waiter_id is null;

select count(*) as open_orders_count from public.pos_orders
where status in ('open','sent','awaiting_bill','sent_to_cashier','partially_paid');

select count(*) as orphan_waiter_rows
from public.pos_orders o
where o.waiter_id is not null
  and not exists (select 1 from public.profiles p where p.id = o.waiter_id);

-- --- Ranking mes actual (exportar profile_id + totales) ---
select profile_id, total_sales, order_count, rank_position
from public.get_waiter_sales_ranking(current_date, false)
order by rank_position;

-- --- Metadatos Git (completar manualmente en §Metadatos) ---
-- git rev-parse HEAD
-- git branch --show-current
```

> **Uso:** completar **antes** de aplicar `184_pos_order_owner_f0a.sql` en el Supabase cloud actual.
> Guardar evidencia fuera de Git (capturas, CSV exportados, notas).
> No incluir claves, tokens ni dumps completos en este archivo.

---

## §B — Respaldo (Paso 2 del runbook; no ejecutar antes de §A)

### Opción A — Backup gestionado (preferida si el plan lo incluye)

1. Supabase Dashboard → **Project Settings** → **Database** → **Backups**
2. Confirmar que existe un backup reciente o disparar backup manual si está disponible
3. Anotar fecha/hora y referencia en §Metadatos (sin subir dumps al repo)

### Opción B — Dump lógico POS (`pg_dump` vía Session pooler)

Usar la cadena **Session pooler** (puerto **5432**), no Transaction pooler (**6543**).

1. Dashboard → **Connect** → pestaña **Session pooler**
2. Copiar **Host**, **Database**, **User** (`postgres.[project-ref]`) y **Port** (`5432`)
3. La contraseña solo en el terminal local (variable de entorno); **nunca** en archivos Git ni en este markdown

**PowerShell (Windows):**

```powershell
# Sustituir HOST, USER y PROJECT_REF desde Dashboard → Connect → Session pooler.
# La contraseña NO va en el repo: pegarla solo en la sesión interactiva o:
#   $env:PGPASSWORD = Read-Host "Database password" -AsSecureString
#   (convertir a texto plano solo en memoria para pg_dump)

$backupDir = Join-Path $env:USERPROFILE "backups\alcazar-f0a"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

pg_dump `
  --host=db.lwpfrdnsiwtmyonwcduh.supabase.co `
  --port=5432 `
  --username=postgres.lwpfrdnsiwtmyonwcduh `
  --dbname=postgres `
  --schema=public `
  --table=public.pos_orders `
  --table=public.pos_order_items `
  --table=public.pos_order_events `
  --table=public.pos_order_payments `
  --no-owner `
  --no-privileges `
  --file="$backupDir\f0a-pre-YYYYMMDD-pos-only.sql"
```

**Verificar host/puerto en Dashboard** — el host puede variar por región; usar el que muestra **Session pooler**, no asumir ciegamente el ejemplo.

| Aspecto | Detalle |
|---------|---------|
| Ubicación | `%USERPROFILE%\backups\alcazar-f0a\` (fuera del repo) |
| Git | Añadir `backups/` local a `.gitignore` personal si hace falta; **no** `git add` del `.sql` |
| Datos sensibles | Totales, UUIDs, nombres en órdenes, pagos |
| Tamaño | Típico KB–MB según volumen POS ERP |

### Opción C — Export CSV desde SQL Editor

Si no tienes `pg_dump` instalado: ejecutar en SQL Editor y **Download CSV** por consulta:

```sql
copy (select * from public.pos_orders) to stdout with csv header;
-- (Si COPY no está habilitado en SQL Editor, usar export UI fila a fila o Table Editor → Export)
```

Como mínimo exportar conteos §A + captura de definiciones (`pg_get_functiondef`, `pg_policies`) en archivos externos.

---

## Metadatos de ejecución

| Campo | Valor |
|-------|-------|
| Fecha y hora (America/Guatemala) | |
| Ejecutor | |
| Entorno | Preproducción temporal (Supabase cloud actual) |
| Project ref (parcial) | `lwpfrd…wcduh` |
| Nombre proyecto | `el-gran-alcazar-system` |
| Git branch | |
| Git commit (`HEAD`) | |
| Frontend desplegado Vercel (si aplica) | sha / URL |
| ¿Backup confirmado antes de migrar? | Sí / No — referencia: |

---

## 1. Estado migración 184 (pre-check)

Ejecutar bloque §A de `docs/pos-f0a-preproduction-snapshot.md` o SQL read-only del paquete F0A.

| Check | Resultado esperado pre-184 | Resultado observado |
|-------|---------------------------|---------------------|
| Columna `owner_profile_id` | **No existe** | |
| FK `pos_orders_owner_profile_id_fkey` | **No existe** | |
| Trigger `sync_pos_order_owner_legacy` | **No existe** | |
| Trigger `guard_pos_order_owner_columns` | **No existe** | |
| `get_waiter_sales_ranking` usa `coalesce(owner, waiter)` | **No** (solo `waiter_id`) | |
| Funciones `diagnose_pos_order_owner_*` | **No existen** | |

**Migración 184 aplicada:** Sí / No / Parcial — notas:

---

## 2. Conteos de órdenes (snapshot A — comparación pura)

> Copiar resultados exactos. Estos valores deben coincidir **post-migración** (validación técnica A).

### Totales

| Métrica | Valor pre-184 | Valor post-184 | OK |
|---------|---------------|----------------|-----|
| `total_orders` | | | |
| `waiter_id_null` | | | |
| `sum_total_paid` (status = paid) | | | |
| `open_orders_count` (status abiertos*) | | | |
| `orphan_waiter_rows` | | | |

\* Status abiertos: `open`, `sent`, `awaiting_bill`, `sent_to_cashier`, `partially_paid`

### Por status

| status | count pre | count post | OK |
|--------|-----------|------------|-----|
| | | | |
| | | | |

### Consultas usadas (referencia)

```sql
-- Guardar salida completa en archivo externo, no en Git.
select count(*) as total_orders from public.pos_orders;
select status, count(*) from public.pos_orders group by 1 order by 1;
select coalesce(sum(total), 0) as sum_total_paid
from public.pos_orders where status = 'paid';
select count(*) as waiter_id_null from public.pos_orders where waiter_id is null;
select count(*) as open_orders_count from public.pos_orders
where status in ('open','sent','awaiting_bill','sent_to_cashier','partially_paid');
```

---

## 3. Ranking mes en curso (snapshot A)

> Exportar filas **sin PII innecesaria** (usar `profile_id` + totales; omitir nombres si no hace falta).

| profile_id (uuid) | total_sales | order_count | rank_position pre | rank_position post | OK |
|-------------------|-------------|-------------|-------------------|--------------------|-----|
| | | | | | |

```sql
select profile_id, display_name, total_sales, order_count, rank_position
from public.get_waiter_sales_ranking(current_date, false)
order by rank_position;
```

**Delta ranking (post debe ser 0 en totales por profile_id):**

| profile_id | total_sales pre | total_sales post | delta |
|------------|-----------------|------------------|-------|
| | | | |

---

## 4. Huérfanos e integridad (pre-184)

Si 184 **no** está aplicada, usar consultas básicas:

```sql
select count(*) as orphan_waiter_rows
from public.pos_orders o
where o.waiter_id is not null
  and not exists (select 1 from public.profiles p where p.id = o.waiter_id);
```

| Métrica | Valor | Explicación |
|---------|-------|-------------|
| orphan_waiter_rows | | |
| Notas | | |

---

## 5. Checksums / comparación estructural (opcional)

| Artefacto | Hash / fingerprint pre | Hash / fingerprint post | OK |
|-----------|------------------------|-------------------------|-----|
| Conteo filas `pos_orders` | | | |
| Conteo filas `pos_order_items` | | | |
| Conteo filas `pos_order_events` | | | |
| Definición `get_waiter_sales_ranking` | (pg_get_functiondef digest manual) | | |
| Políticas RLS `pos_orders` INSERT | | | |

```sql
select count(*) from public.pos_order_items;
select count(*) from public.pos_order_events;
select pg_get_functiondef('public.get_waiter_sales_ranking(date, boolean)'::regprocedure);
select policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'pos_orders';
```

---

## 6. Diagnóstico F0A (solo post-184)

Completar **después** de migración:

```sql
select * from public.diagnose_pos_order_owner_integrity() order by check_code;
select count(*) as orphan_rows from public.diagnose_pos_order_owner_orphans();
select * from public.test_pos_order_owner_f0a_rules();
```

| check_code | metric pre | metric post | OK |
|------------|------------|-------------|-----|
| owner_waiter_mismatch | N/A | debe ser 0 | |
| 184_test failed rows | N/A | debe ser 0 | |

---

## 7. Simulación operativa (snapshot B — separado)

> **No mezclar** con §2–§4. Ejecutar solo después de aprobar validación técnica A.

| Campo | Valor |
|-------|-------|
| order_id simulación | |
| mesa / table_id | |
| mesero A (owner esperado) | profile_id |
| mesero B (ayuda) | profile_id |
| productos (solo `is_test_item`) | |
| ¿KDS enviado? | |
| ¿Cobro completado? | método / monto |
| owner = waiter post-simulación | OK/FAIL |
| Efectos externos observados | impresión / caja / notif / ranking delta |

---

## 8. Decisión

| Gate | Resultado |
|------|-----------|
| Validación técnica A | OK / FAIL |
| Simulación operativa B | OK / FAIL / Omitida |
| ¿Aprobar deploy frontend Vercel? | Sí / No |
| F0B | **BLOQUEADA** hasta aprobación explícita |

Firma / fecha:
