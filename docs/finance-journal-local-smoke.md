# Smoke UI local — Partidas contables

Runner reutilizable para validar el flujo manual de partidas contables contra **Supabase local** y **Vite**, sin conectar Stage/Producción.

## Ejecutar

Desde la raíz del repositorio (después de `npm install`):

```bash
node scripts/run-finance-journal-ui-smoke.mjs
```

Opcional:

```bash
KEEP_SMOKE_ARTIFACTS=1 node scripts/run-finance-journal-ui-smoke.mjs
```

Conserva el directorio temporal de Supabase y capturas (sin tokens ni contraseñas en logs).

## Dependencias (package.json raíz)

Los scripts en `/scripts` usan las **devDependencies del package.json raíz**, no las de `frontend/`:

| Paquete | Versión fijada | Uso |
|---------|----------------|-----|
| `playwright` | `1.61.1` | E2E browser |
| `supabase` | `2.107.0` | CLI local (stack en `%TEMP%`, binario desde el repo) |

Instalación:

```bash
npm install
npx playwright install chromium
```

`npx playwright install chromium` descarga el browser fuera del repo (~150 MB, caché del usuario). **No** se versiona en Git.

## Requisitos

| Requisito | Notas |
|-----------|--------|
| Docker Desktop | Supabase local (`supabase start` vía CLI del repo) |
| Node 20+ | Runner y tests unitarios |
| `npm install` en raíz | Resuelve `playwright@1.61.1` y `supabase@2.107.0` |

## Seguridad (bloqueos explícitos)

- Directorio temporal **fuera del repo** (`%TEMP%` / `/tmp`).
- `supabase init/start` solo en ese directorio; **no** usa `supabase/.temp/project-ref` del repositorio.
- El binario Supabase se resuelve desde `node_modules/supabase` en la raíz (versión fijada).
- Aborta si API/DB/Studio no son `127.0.0.1` o `localhost`.
- **No** ejecuta `db push`, `migration repair` ni deploy remoto.
- **No** imprime JWT, service role ni contraseñas (redacción en errores).
- Usuarios de prueba vía **signup** GoTrue + `profiles` (no `crypt()` en SQL).

## Qué hace el runner

### Entorno

1. Bootstrap mínimo compatible con `AuthContext` (`profiles`, `user_roles`, `normalize_profile_role`, grants).
2. Migraciones **202 → 203 → 204** desde `supabase/schema/`.
3. `GRANT SELECT ON public.profiles TO authenticated, anon`.
4. Signup: `ui-contador-smoke@test.local`, `ui-gerente-smoke@test.local`.
5. Fixtures **LOCAL TEST**: cuentas `1.01-LOCAL`, `5.01-LOCAL`, centro `CC-LOCAL`, periodo del mes actual.
6. Vite en `http://127.0.0.1:5174` con `VITE_SUPABASE_*` inline (sin modificar `.env`).

### E2E (Playwright)

Flujo contador → gerente → reversión, cambios sin guardar, y evidencia en viewports **1440×900**, **768×1024**, **375×812**.

Salida: `%TEMP%/alcazar-finance-journal-smoke-artifacts-*/` con `results.json`, `status-redacted.json` y `screenshots/`.

### Limpieza (`try/finally`)

- Cierra navegador, termina Vite y procesos hijos.
- `supabase stop --no-backup` en el directorio temporal.
- Elimina el directorio temporal (salvo `KEEP_SMOKE_ARTIFACTS=1`).
- Exit code **≠ 0** si falla cualquier paso.

## Verificaciones complementarias

```bash
cd frontend && npm run test:finance
cd frontend && npm run build
git diff --check
```

## Corrección UX relacionada

El botón **Enviar a aprobación** usa `canSubmitJournalForm()` (no solo `diferencia === 0`). Requiere descripción, fecha, ≥2 líneas, cuenta e importe por línea, balance y dimensiones.

Tests unitarios: `frontend/src/utils/financeJournalValidation.test.js`.
