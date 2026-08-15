# Finance accounting — Stage application runbook

**Draft PR:** #23 · **Branch:** `feat/finance-accounting-foundation`
**Migrations:** `202` → `203` → `204` (manual, sequential, one at a time)

---

## ⚠️ Advertencias obligatorias

| Regla | Detalle |
|-------|---------|
| **Stage únicamente** | Este runbook aplica solo al entorno Stage autorizado. |
| **Prohibido Producción** | No ejecutar en Production bajo ninguna circunstancia. |
| **Prohibido `supabase db push`** | Aplicación manual vía SQL Editor o `psql` supervisado. |
| **Prohibido `migration repair`** | No alterar historial de migraciones Supabase. |
| **Prohibido `*_test_*` como migración** | Los archivos `*_test_*.sql` y adversarial son verificación, no deploy. |
| **Secuencial con gates** | Confirmar resultado de **cada paso** antes del siguiente. |
| **Fail-closed** | Ante cualquier error: **STOP**. No continuar. |

---

## Clasificación de archivos (no confundir con migraciones automáticas)

| Categoría | Rutas | Tratamiento |
|-----------|-------|-------------|
| **Migraciones productivas** | `supabase/schema/202_finance_accounting_chart_of_accounts.sql`, `203_finance_accounting_multibranch_foundation.sql`, `204_finance_accounting_journal_engine.sql` | Aplicar manualmente en Stage, en orden, una a la vez |
| **Tests SQL** | `supabase/schema/*_test_*.sql`, adversarial | Solo laboratorio/CI; **nunca** `supabase db push` ni SQL Editor en Stage |
| **Laboratorio local** | `supabase/lab/`, `scripts/run-finance-full-schema-lab.mjs` | Docker local únicamente; rechaza hosts remotos |
| **Fixtures Stage** | `supabase/stage-fixtures/` | Preflight, postchecks, smoke; read-only o transaccional con ROLLBACK |
| **Rollbacks** | `supabase/rollback/`, `supabase/rollback/fragments/` | Manual, orden 204 → 203 → re-aplicar 202 → 202 rollback |
| **Evidencia local** | `.local-backup/`, dumps, snapshots | **No commitear**; fuera de Git |

---

## A. Preparación

1. Verificar Draft PR #23 revisado (sin merge).
2. Confirmar autorización explícita para aplicar en **Stage**.
3. Tener acceso de lectura/escritura SQL en Stage (no service role en cliente).
4. Revisar paquete en repo:
   - `supabase/stage-fixtures/finance_accounting_stage_preflight.sql`
   - `supabase/stage-fixtures/finance_accounting_stage_identity_bootstrap.sql`
   - `supabase/stage-fixtures/finance_accounting_postcheck_202.sql`
   - `supabase/stage-fixtures/finance_accounting_postcheck_203.sql`
   - `supabase/stage-fixtures/finance_accounting_postcheck_204.sql`
   - `supabase/stage-fixtures/finance_accounting_stage_smoke.sql`
   - `supabase/rollback/202_*.rollback.sql` … `204_*.rollback.sql`
   - `supabase/rollback/finance_accounting_stage_identity_bootstrap.rollback.sql`
   - `scripts/stage-finance-accounting-snapshot.ps1`
5. Validar localmente (operador):

```powershell
node scripts/run-finance-full-schema-lab.mjs
node scripts/run-finance-stage-package-local-validation.mjs
node scripts/run-finance-stage-identity-bootstrap-lab.mjs
```

6. Coordinar ventana con equipo; comunicar posible rollback.

---

## B.0 — Stage existente sin identidad contable (primer preflight NOT_READY)

Use this path when Stage already has ERP/FELplex work but `app_settings.deployment_environment`
is **absent** or incomplete. Real Stage preflight may return `NOT_READY` only on:

- `deployment_project_ref_present`
- `environment_is_stage`
- `project_ref_matches`

### Orden de seguridad (obligatorio)

1. **Validación externa URL/ref** (operador, fuera de SQL):
   - Confirmar Stage project ref y Production project ref son **distintos**.
   - Confirmar la URL de conexión contiene el Stage ref esperado.
   - Confirmar la URL **no** contiene el Production ref.
   - Exportar refs solo en variables de entorno locales (`ALCAZAR_STAGE_PROJECT_REF`, `ALCAZAR_PRODUCTION_PROJECT_REF`).
2. **Preflight READ ONLY** (baseline documentado; puede ser `NOT_READY` por identidad).
3. **Snapshot baseline** antes de la primera escritura:
   - Si `deployment_environment` **no existe**, usar modo `-UninitializedStage`.
   - Si ya existe con valores correctos, usar snapshot normal.
4. **Bootstrap identidad** — **solo** vía `scripts/invoke-finance-stage-identity-bootstrap.ps1` (no SQL manual).
5. **Preflight READ ONLY** nuevamente → debe ser `READY`.
6. **STOP** — no aplicar 202/203/204 hasta nueva autorización.

### Bootstrap identidad (transaccional)

**Ejecución remota obligatoria:** usar únicamente el wrapper PowerShell. No pegar SQL manualmente en Supabase SQL Editor.

```powershell
$env:ALCAZAR_STAGE_PROJECT_REF = "<stage-ref-from-vault>"
$env:ALCAZAR_PRODUCTION_PROJECT_REF = "<production-ref-from-vault>"
$env:ALCAZAR_STAGE_DATABASE_URL = "<connection-string-from-vault>"

# Tras snapshot UninitializedStage (manifest-*.json):
powershell -File scripts/invoke-finance-stage-identity-bootstrap.ps1 `
  -SnapshotManifestPath "<path-to-manifest-*.json>" `
  -MaxSnapshotAgeHours 24
```

El wrapper:

1. Valida URI PostgreSQL (host/username deben demostrar Stage ref; rechaza Production ref).
2. Verifica manifest UninitializedStage (SHA-256, refs, antigüedad ≤ 24 h por defecto).
3. Exige confirmación humana: escribir **exactamente** el Stage project ref (case-sensitive).
4. Preflight READ ONLY — continúa solo si `NOT_READY` con blockers **exactamente**:
   `deployment_project_ref_present`, `environment_is_stage`, `project_ref_matches`.
5. Ejecuta `finance_accounting_stage_identity_bootstrap.sql` (refs vía `set_config` tras `BEGIN`).
6. Preflight READ ONLY → exige `READY`.
7. **STOP** — no snapshot adicional, smoke ni migraciones 202–204.

Antigüedad máxima razonable del snapshot: **24 horas** (`-MaxSnapshotAgeHours`, ajustable). Capturar snapshot fresco si expira.

Notas:

- El wrapper **no imprime** contraseñas ni URI completas; logs redactados en `.local-backup/finance-stage-identity-bootstrap-wrapper/`.
- **No elimina** `ALCAZAR_STAGE_DATABASE_URL` del proceso padre (solo limpia `PGPASSWORD` auxiliar).
- Usa `psql` local si está en PATH; si no, `docker run postgres:16-alpine` con repo montado read-only.

Referencia manual (solo depuración local en Docker):

```sql
-- NO usar en Stage remoto — usar invoke-finance-stage-identity-bootstrap.ps1
SELECT set_config('alcazar.finance_stage_project_ref', '<stage-ref-from-vault>', true);
SELECT set_config('alcazar.finance_production_project_ref', '<production-ref-from-vault>', true);
-- supabase/stage-fixtures/finance_accounting_stage_identity_bootstrap.sql
```

Reglas fail-closed del SQL bootstrap:

- Aborta si Stage ref = Production ref.
- Inserta **solo** si `deployment_environment` está ausente.
- **Nunca** sobrescribe `name`/`project_ref` existentes diferentes.
- Idempotente si ya existe `name=stage` y `project_ref` correcto.
- **No toca** otras filas (`felplex`, branding, etc.).
- Marca filas creadas con `finance_accounting_identity_bootstrap=true` para rollback puntual.

Rollback puntual:

```text
supabase/rollback/finance_accounting_stage_identity_bootstrap.rollback.sql
```

Elimina únicamente filas con el marcador bootstrap y valores esperados. Sin CASCADE.

### Snapshot UninitializedStage

Cuando el marcador `deployment_environment` aún no existe:

```powershell
$env:ALCAZAR_STAGE_PROJECT_REF = "<stage-ref-from-vault>"
$env:ALCAZAR_PRODUCTION_PROJECT_REF = "<production-ref-from-vault>"
$env:ALCAZAR_STAGE_DATABASE_URL = "<connection-string-from-vault>"
powershell -File scripts/stage-finance-accounting-snapshot.ps1 -UninitializedStage
```

Modo `-UninitializedStage`:

- Permitido **solo** si `deployment_environment` está ausente.
- URL debe contener Stage ref; no debe contener Production ref.
- Aborta si el entorno remoto ya indica `production`/`prod`.
- El manifest incluye `manifest_version`, `stage_project_ref`, `production_project_ref`, `created_at` y SHA-256 de artefactos.
- El wrapper de bootstrap exige manifest `uninitialized_stage=true` con antigüedad ≤ 24 h (configurable).

---

## B. Preflight read-only

1. En Supabase SQL Editor (**Stage**), establecer el identificador de proyecto para esta sesión (valor del vault, debe coincidir con `app_settings`):

```sql
SELECT set_config('alcazar.finance_stage_project_ref', '<stage-project-ref-from-vault>', true);
SELECT set_config('alcazar.finance_production_project_ref', '<production-project-ref-from-vault>', true);
```

2. Verificar que `app_settings.deployment_environment` contiene:

```sql
select key, value from public.app_settings where key = 'deployment_environment';
-- Requerido: value.name = 'stage'
-- Requerido: value.project_ref = mismo valor que alcazar.finance_stage_project_ref
```

3. Ejecutar preflight dentro de transacción READ ONLY:

```sql
SET default_transaction_read_only = on;
BEGIN READ ONLY;
SELECT set_config('alcazar.finance_stage_project_ref', '<stage-project-ref-from-vault>', true);
-- pegar supabase/stage-fixtures/finance_accounting_stage_preflight.sql
ROLLBACK;
```

4. Resultado final **debe ser `READY`**. Si es `NOT_READY`: **STOP**.

   El preflight **no acepta** confirmación manual alternativa. Si falta `project_ref`, no coincide, o el entorno es `production`/`prod`, aborta.

---

## C. Snapshot

1. Planificar (sin conexión ni archivos):

```powershell
powershell -File scripts/stage-finance-accounting-snapshot.ps1 -DryRun
```

2. Exportar conexión Stage **solo** en variable de entorno (no archivos):

```powershell
$env:ALCAZAR_STAGE_PROJECT_REF = "<stage-ref-from-vault>"
$env:ALCAZAR_PRODUCTION_PROJECT_REF = "<production-ref-from-vault>"
$env:ALCAZAR_STAGE_DATABASE_URL = "<connection-string-from-vault>"
powershell -File scripts/stage-finance-accounting-snapshot.ps1
```

   Si `deployment_environment` aún no existe, usar `-UninitializedStage` (sección B.0).

3. Verificar manifest JSON con hashes SHA-256.
4. Si falla cualquier dump: **STOP**.

---

## D. Aplicación (orden estricto)

> Cada migración es **transaccional**. En `psql`: `-v ON_ERROR_STOP=1`.
> En SQL Editor: pegar archivo completo; si error antes de COMMIT implícito, revertir sesión.

### D.1 — Migración 202

```text
supabase/schema/202_finance_accounting_chart_of_accounts.sql
```

### D.2 — Validación post-202

```text
supabase/stage-fixtures/finance_accounting_postcheck_202.sql
```

Resultado: `finance_accounting_postcheck_202 = PASS`. Si FAIL: **STOP** → rollback 202.

### D.3 — Migración 203

```text
supabase/schema/203_finance_accounting_multibranch_foundation.sql
```

### D.4 — Validación post-203

```text
supabase/stage-fixtures/finance_accounting_postcheck_203.sql
```

### D.5 — Migración 204

```text
supabase/schema/204_finance_accounting_journal_engine.sql
```

### D.6 — Validación post-204

```text
supabase/stage-fixtures/finance_accounting_postcheck_204.sql
```

**No concatenar** 202+203+204 en una sola ejecución ciega.

---

## E. Validación estructural

Además de postchecks, opcionalmente ejecutar suites de laboratorio (no en Stage salvo autorización):

| Suite | Archivo |
|-------|---------|
| Catálogo | `202_test_finance_chart_accounts.sql` |
| Multisucursal | `203_test_finance_accounting_multibranch_foundation.sql` |
| Journal | `204_test_finance_accounting_journal_engine.sql` |

En Stage usar preferentemente el smoke transaccional (sección F).

---

## F. Smoke funcional (Stage)

```text
supabase/stage-fixtures/finance_accounting_stage_smoke.sql
```

- Prefijo `STAGE_FINANCE_SMOKE`
- `BEGIN` … `ROLLBACK` — sin datos persistentes
- Resultado: `finance_accounting_stage_smoke = PASS`
- Si FAIL: evaluar **ROLLBACK** (sección H)

Verificar UI Finanzas (contador): catálogo, partidas, flujo draft → posteo (sin datos reales de negocio).

---

## G. Decisión continuar / detener

### Matriz GO

| Criterio | Requerido |
|----------|-----------|
| Preflight | `READY` |
| Snapshot | Completo + hashes |
| Migración N | Aplicada sin error |
| Postcheck N | `PASS` |
| Objetos parciales | Ninguno |
| Smoke | `PASS` |
| UI | Operable por contador |

→ **GO** continuar operación normal en Stage / preparar merge según proceso.

### Matriz STOP

- Entorno dudoso (no Stage)
- Snapshot fallido
- Dependencia 001–200 ausente
- Objeto parcial (journal sin RPC, etc.)
- Error SQL en apply
- Postcheck / test FAIL
- Permisos inesperados
- Conteos baseline sin explicación

→ **STOP** — no aplicar siguiente migración; evaluar rollback.

### Matriz ROLLBACK

- Error después de apply
- Smoke FAIL
- UI no puede operar partidas
- Permisos incorrectos
- Reversión incompleta

→ Ejecutar rollback **204 → 203 → 202** (sección H).

---

## H. Rollback

**Orden:** 204 → 203 → 202

1. Establecer identidad Stage en sesión (mismo `project_ref` que preflight):

```sql
select set_config('alcazar.finance_stage_project_ref', '<stage-project-ref-from-vault>', false);
```

2. Ejecutar desde `supabase/rollback/`:

```text
204_finance_accounting_journal_engine.rollback.sql
203_finance_accounting_multibranch_foundation.rollback.sql
```

3. Re-aplicar idempotente (restaura RPCs de catálogo tras rollback 203):

```text
supabase/schema/202_finance_accounting_chart_of_accounts.sql
```

4. Si se revierte por completo la fundación contable:

```text
202_finance_accounting_chart_of_accounts.rollback.sql
```

3. Cada script debe terminar con `PASS`.
4. Re-ejecutar preflight → debe ser `READY` (objetos 202–204 ausentes).
5. Restaurar desde snapshot si rollback falla.

**Notas:**

- 204 rechaza rollback si hay partidas posted reales.
- 203 rechaza rollback si hay sucursales/CC/periodos reales fuera de seed.
- 202 rechaza rollback si hay cuentas reales; **no elimina** rol `contador` si está en uso.

---

## I. Evidencia y cierre

Registrar en ticket/incidente:

- [ ] Timestamp inicio/fin
- [ ] Operador
- [ ] Preflight output (`READY`)
- [ ] Snapshot manifest + SHA-256
- [ ] Postcheck 202/203/204 (`PASS`)
- [ ] Smoke (`PASS`)
- [ ] Capturas UI (opcional)
- [ ] Decisión GO / STOP / ROLLBACK
- [ ] Enlace PR #23

---

## Referencia local (no Stage)

| Script | Propósito |
|--------|-----------|
| `scripts/run-finance-full-schema-lab.mjs` | ERP 001–200 + 202–204 + tests SQL |
| `scripts/run-finance-stage-package-local-validation.mjs` | Simula apply/postcheck/smoke/rollback |
| `supabase/lab/bootstrap-supabase-local.sql` | Bootstrap versionado |
| `supabase/lab/finance_accounting_test_auth_seed.sql` | Seed auth para tests |

---

## Fuera de alcance de este runbook

- Merge PR / deploy frontend
- Aplicación en Production
- Automatización POS/compras/caja
- FELplex / numeración 201
