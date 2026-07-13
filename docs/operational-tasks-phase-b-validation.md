# Validación Fase B — Módulo Trabajo (Kanban)

Documento operativo para aplicar la migración `180` y ejecutar el protocolo de pruebas antes del commit.

## 1. Aplicar migración 180

### Prerrequisito

Migraciones **176 → 179** ya aplicadas en el proyecto Supabase conectado.

### Paso 0 — Preflight (obligatorio)

En **Supabase → SQL Editor**, ejecutar:

`supabase/tests/preflight_180_task_card_board.sql`

| Query | Resultado esperado | Si falla |
|-------|-------------------|----------|
| A. RPCs 176–179 | 4 filas | Aplicar migraciones faltantes |
| B. `waiting_reason` inválidos | **0 filas** | Normalizar valores antes de 180 |
| C. Duplicados `task_assignees` activos | **0 filas** | Deduplicar antes de 180 |
| D–F | Informativo | — |

> **Riesgo bloqueante:** si existen duplicados activos en `task_assignees`, la línea  
> `create unique index task_assignees_active_profile_uidx` **fallará** y abortará el script.

### Paso 1 — Aplicar 180

1. Abrir [Supabase Dashboard](https://app.supabase.com) → proyecto conectado.
2. **SQL Editor** → Nueva query.
3. Copiar **todo** `supabase/schema/180_task_card_board.sql`.
4. Ejecutar **Run**.
5. Tiempo esperado: **5–15 s**.

### Paso 2 — Verificación post-apply

Ejecutar:

`supabase/tests/verify_operational_tasks_phase_b.sql`

Resultados esperados:

- `sort_position` → 1 fila (`numeric`, `NOT NULL`, default `0`)
- `assigned_tasks_waiting_reason_check` → incluye `'date'`
- Índices `task_assignees_active_profile_uidx` y `assigned_tasks_operational_sort_idx` → presentes
- RPCs listados → 8 funciones
- Grants `authenticated` → `EXECUTE` en RPCs nuevos

### Paso 3 — Diagnóstico sort_position (tras pruebas funcionales)

Ejecutar:

`supabase/tests/diagnose_sort_position.sql`

### Paso 4 — Frontend

En `frontend/.env` (o `.env.development` si no hay override):

```env
VITE_ERP_TASKS_V2=true
```

Reiniciar dev server:

```bash
cd frontend
npm run dev
```

---

## 2. Auditoría estática de la migración 180

| Criterio | Estado | Notas |
|----------|--------|-------|
| Idempotente cuando corresponde | ✅ | `IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `CREATE OR REPLACE` |
| No rompe `assigned_tasks` existentes | ✅ | `ADD COLUMN` con default; backfill solo `operational` + `sort_position = 0` |
| No toca `employee_expediente` | ✅ | RPCs filtran `task_source = 'operational'`; columna `sort_position` es inerte para expediente |
| No modifica checklists/procesos | ✅ | Sin cambios en tablas/RPCs de checklists ni procesos |
| `waiting_reason` compatible | ✅ | Mismos valores 176 + `'date'`; preflight detecta outliers |
| `sort_position` seguro | ✅ | Default `0` + backfill `epoch(created_at)*1000` para operational |
| `CREATE OR REPLACE` en RPCs | ✅ | Todas las funciones reemplazadas correctamente |
| Grants | ⚠️ Parcial | Nuevas funciones con `REVOKE`/`GRANT`; reemplazos heredan grants previos |
| `SECURITY DEFINER` + `search_path = ''` | ✅ | Todas las funciones nuevas/modificadas |
| `is_current_profile_active()` | ✅ | En board, detail, move, update, assignees, quick create, status |
| Índices idempotentes | ✅ | `CREATE INDEX IF NOT EXISTS` |

### Regla `waiting_reason` al salir de Esperando

Implementado en `move_operational_task` y `update_operational_task_status`:

```sql
waiting_reason = case when v_status = 'waiting' then p_waiting_reason else null end
```

Al salir de `waiting`, el motivo se **limpia** (recomendación aceptada).

---

## 3. Protocolo funcional por rol

Marcar cada ítem: ✅ Aprobado / ❌ Fallido / ⏳ Pendiente (requiere ejecución manual).

### Gerencia

| Prueba | Estado |
|--------|--------|
| Abrir tablero | ⏳ |
| Crear tarea rápida | ⏳ |
| Editar título / descripción / prioridad | ⏳ |
| Asignar responsable + participante | ⏳ |
| Fecha límite + próxima acción | ⏳ |
| Flujo estados → Esperando (motivo obligatorio) → revisión → completada | ⏳ |
| Reordenar en columna + mover entre columnas | ⏳ |
| Copiar enlace + abrir en otra pestaña + recargar | ⏳ |

### CEO

| Prueba | Estado |
|--------|--------|
| Ver tablero permitido | ⏳ |
| Abrir tareas | ⏳ |
| No modificar ajenas solo por ser CEO | ⏳ |
| Sí modificar si creador/responsable/participante | ⏳ |
| UI oculta acciones no permitidas (`permissions`) | ⏳ |
| RPC directo rechaza mutación no autorizada | ⏳ |

### Supervisor

| Prueba | Estado |
|--------|--------|
| Crear/asignar en jerarquía | ⏳ |
| Rechazo fuera de reportes (`can_assign_profile_to_operational_task`) | ⏳ |
| No modificar fuera de ámbito | ⏳ |
| Misma regla en quick create y panel | ⏳ |

### Colaborador

| Prueba | Estado |
|--------|--------|
| Solo ve sus tareas (`get_my_operational_tasks`) | ⏳ |
| Edita campos autorizados | ⏳ |
| No reasigna | ⏳ |
| Deep link ajeno → error genérico sin filtrar datos | ⏳ |

### Usuario inactivo

| Prueba | Estado |
|--------|--------|
| Board / detail / mutaciones bloqueadas | ⏳ |

---

## 4. Dos dispositivos / sincronización

**Modelo actual (Fase B):** sincronización **razonable sin Realtime**.

| Mecanismo | Cuándo | Comportamiento |
|-----------|--------|----------------|
| **Optimistic + refetch** | Tras cada mutación | Actualiza tarjeta local → RPC → `refresh({ background: true })` + detalle si drawer abierto |
| **Refetch al foco** | `visibilitychange` visible | Debounce 2.5 s; omite detalle si hay ediciones sin guardar; ejecuta chequeo de conflicto |
| **Refetch al montar vista** | Entrar a tablero / mi-trabajo | `useEffect` en hook de lista |
| **Botón Actualizar** | Manual | Conserva filtros y drawer; no pierde cambios locales |
| **Realtime** | — | ❌ No implementado |
| **Polling** | — | ❌ No implementado |

### Conflicto básico (`updated_at`)

- Al guardar o si el servidor cambió mientras editas, aparece:
  > Esta tarea cambió mientras la estabas editando.
- Opciones: **Recargar datos** / **Mantener cambios locales**
- Sin versionado colaborativo completo.

### Pruebas de sincronización (añadidas)

| Prueba | Esperado |
|--------|----------|
| Crear/editar/mover tarea | Tarjeta local inmediata + refetch background sin recargar página |
| Volver a pestaña del navegador | Lista se actualiza tras ~2.5 s (si no hay edición abierta) |
| Volver a pestaña con drawer editando | Lista se actualiza; detalle no se sobrescribe; banner de conflicto si `updated_at` cambió |
| Navegar fuera y volver a tablero/mi-trabajo | Refetch al montar componente |
| Botón **Actualizar** | Muestra “Actualizando…”, conserva filtros y drawer |
| Dos usuarios editando misma tarea | Aviso de conflicto; opciones recargar / mantener local |
| Última actualización | Hora visible en barra de sync |

---

1. Gerencia crea tarea (A) → Colaborador (B) ve tras **Actualizar** o **volver a la pestaña** (foco).
2. Colaborador cambia estado (B) → Gerencia ve tras **Actualizar** o refocus.
3. Recargar página conserva `sort_position` (DB).

**No afirmar sincronización instantánea.**

---

## 5. Deep links

| URL | Comportamiento esperado |
|-----|-------------------------|
| `/tasks/trabajo/tablero?task=<id>` | Abre panel en tablero |
| `/tasks/trabajo/mi-trabajo?task=<id>` | Abre panel en mi trabajo |
| Sin permiso | Mensaje genérico; **sin** título/responsable/descripción |
| `employee_expediente` | `get_operational_task_detail` exige `operational` → "Tarea no encontrada" |

---

## 6. Archivo legacy `TaskDetailDrawer.jsx`

Búsqueda estática:

- ❌ Sin imports activos en `frontend/src`
- ❌ Sin import dinámico
- ❌ No participa con `VITE_ERP_TASKS_V2=false` (rutas Trabajo ocultas por flag)

**Mantener** hasta commit de limpieza separado.

---

## 7. Regresiones (flag ON y OFF)

Con `VITE_ERP_TASKS_V2=true`: validar checklists, procesos, notificaciones, RRHH expediente.

Con `VITE_ERP_TASKS_V2=false`: dashboard clásico `/tasks?view=dashboard` sin errores de consola.

---

## 8. Reindexación futura `sort_position`

Umbral propuesto para función futura `normalize_operational_task_sort_positions()`:

- Gap mínimo entre vecinos **< 0.001** en una columna con **> 20** tareas activas
- O más de **200** eventos `moved` en 7 días por área

No implementar motor de reindexación en Fase B.

---

## 9. Checklist antes del commit

- [ ] Preflight 180 → 0 bloqueantes
- [ ] Migración 180 aplicada sin error
- [ ] verify_operational_tasks_phase_b.sql → OK
- [ ] Pruebas críticas por rol → todas ✅
- [ ] diagnose_sort_position.sql → sin nulls ni inconsistencias
- [ ] `npm run build` → exit 0
- [ ] Sin secretos en staging area

**Commit propuesto (solo tras checklist completo):**

```
feat(tasks): implement professional kanban cards and task detail panel
```

**No push** hasta confirmación explícita.
