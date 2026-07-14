# Auditoría RPC — `get_operational_tasks_board` (183b)

**Fuente:** `supabase/schema/183b_task_labels_archive_rpcs.sql`  
**Flujo:** RPC → scan `assigned_tasks` → `can_access` por fila → `operational_task_card_summary` por fila → `jsonb_agg` → sort

---

## Flujo interno

```
get_operational_tasks_board(p_area_id, p_assignee_id, p_search, …)
│
├─ auth.uid() + is_current_profile_active()          [1× por llamada]
│
└─ SELECT jsonb_agg(
     operational_task_card_summary(t)
     ORDER BY sort_position, created_at
   )
   FROM assigned_tasks t
   WHERE
     task_source = 'operational'
     AND deleted_at / archived_at IS NULL
     AND can_access_operational_task(t, 'view')     ← N×
     AND status / completed window filters
     AND area / assignee / search / label filters
```

---

## Tabla de etapas

| Etapa | Función / operación | ¿1× o N×? | Costo estimado | Riesgo |
|-------|---------------------|:---------:|----------------|--------|
| Validación sesión | `auth.uid()`, `is_current_profile_active()` | **1×** | Bajo | — |
| Scan base | `assigned_tasks` + filtros estáticos | **1× scan** | Medio | Seq Scan si sin índice |
| Autorización filtro | `can_access_operational_task(t,'view')` | **N×** | **Alto** | plpgsql + EXISTS assignees por fila |
| Filtro área | `t.area_id = p_area_id` | 1× scan | Bajo | — |
| Filtro asignado | EXISTS `task_assignees` | N× en loop | Medio | — |
| Búsqueda texto | LIKE title/objective/steps | N× | Medio-alto | Seq + subquery steps |
| Filtro etiquetas | EXISTS `task_label_assignments` | N× | Medio | — |
| **Card summary** | `operational_task_card_summary(t)` | **N×** | **Muy alto** | Ver desglose abajo |
| Orden final | `ORDER BY sort_position, created_at` | 1× sobre N | Medio | Sort en memoria |
| Agregación JSON | `jsonb_agg` | 1× | Medio | Proporcional a payload |

**N** = tarjetas que pasan `can_access` (típico 30–80 en staging).

---

## Desglose `operational_task_card_summary(t)` — por tarjeta

| Sub-etapa | Función / query | N× | Costo | Riesgo |
|-----------|-----------------|:--:|-------|--------|
| Work card | `get_task_work_card_summary(task_id)` | 1 | **Alto** | 2 subqueries steps + join lists + depends_on |
| Área nombre | `SELECT name FROM areas` | 1 | Bajo | — |
| Etiquetas | `task_labels_for_task(task_id)` | 1 | Medio | jsonb_agg labels |
| Assignees completos | jsonb_agg task_assignees + profiles | 1 | Medio | Payload inflado |
| Primary assignee | subquery assignees primary | 1 | Bajo | Duplica assignees |
| Permisos tarjeta | `get_operational_task_permissions(t)` | 1 | **Muy alto** | 10+ funciones; `can_access` **otra vez** |
| Campos pesados | objective, expected_result, work_summary | 1 | Medio | Payload |

---

## Desglose `get_operational_task_permissions(t)` — por tarjeta

| Check | Función | N× |
|-------|---------|:--:|
| can_view | `can_access_operational_task` | 1 |
| can_edit / can_move | `can_mutate_operational_task` | 2 |
| can_assign / manage_members | `can_manage_operational_task_members` | 2 |
| manage_watchers | `can_manage_operational_task_watchers` | 1 |
| is_watching | `is_operational_task_watcher` | 1 |
| work_plan | `can_manage_task_work_plan` | 1 |
| files / comment / evidence | 3 funciones | 3 |
| labels admin | `can_manage_task_labels` | 1 |
| archive / restore | EXISTS + role checks | 2 |

**Total aproximado por tarjeta visible:** 20–30 invocaciones de funciones SQL/plpgsql.

---

## Funciones que escalan con cantidad de tarjetas (N)

| Función | Veces por request | Confirmado |
|---------|------------------:|:----------:|
| `can_access_operational_task` | **2N** (WHERE + permissions.can_view) | Sí |
| `operational_task_card_summary` | **N** | Sí |
| `get_task_work_card_summary` | **N** | Sí |
| `task_labels_for_task` | **N** | Sí |
| `get_operational_task_permissions` | **N** | Sí |
| `can_mutate_operational_task` | **~3N** (dentro permissions) | Sí |
| Subquery assignees en card | **N** | Sí |

---

## Conclusión

El cuello dominante es **O(N)** con funciones anidadas, no el render React ni duplicados menores del frontend. La medición 7.94 → 7.79 s (−1.9 %) es coherente: ~150 ms ahorrados en red menor, **~6–7 s siguen en el RPC**.

La optimización debe atacar:

1. Eliminar `can_access` por fila → visibilidad set-based (contexto actor 1×).
2. Eliminar `operational_task_card_summary` → agregaciones JOIN en un solo query.
3. Reducir permisos a 3 flags en listado; detalle conserva permisos completos.
4. Recortar payload (sin objective/expected_result/assignees[]).
