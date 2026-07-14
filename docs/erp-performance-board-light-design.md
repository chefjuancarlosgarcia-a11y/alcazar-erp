# Diseño — Board light (`get_operational_tasks_board_light`)

**Estado:** propuesta · **no implementar** hasta EXPLAIN + Semana 1  
**Meta:** primer paint interactivo < 1.5 s · payload mínimo para Kanban

---

## 1. Problema actual

`get_operational_tasks_board` (183b) ejecuta por cada fila visible:

1. `can_access_operational_task(t, 'view')` en el `WHERE`
2. `operational_task_card_summary(t)` en el `SELECT` (jsonb_agg)

Con 50–80 tarjetas esto implica **O(n) funciones por fila**, cada una con subconsultas (assignees, labels, work summary, permisos). La instrumentación estima **68–78 %** del tiempo total en este RPC.

---

## 2. Primer paint — campos necesarios

| Campo | Uso en Kanban |
|-------|----------------|
| `id` | clave, drag, deep link |
| `title` | tarjeta |
| `status` | columna |
| `priority` | badge |
| `due_at` | vencimiento |
| `waiting_reason` | columna espera |
| `sort_position` | orden DnD |
| `updated_at` | conflicto / sync |
| `primary_assignee` | `{ id, full_name, avatar_url }` compacto |
| `labels` | máx. 3 `{ id, name, color_key }` |
| `steps_progress` | `{ done, total }` agregado |
| `permissions` | scope mínimo: `can_edit`, `can_move`, `can_archive` |

**Excluido del primer paint** (carga en detalle al abrir tarjeta):

- `description`, `objective`, `expected_result`
- `activity`, `comments`, `attachments`, `evidence`
- `work_plan` completo, `participants`/`watchers` completos
- permisos granulares por acción si derivan de un scope agregado

---

## 3. Opción A — Optimizar RPC actual

### Enfoque

- Mantener firma `get_operational_tasks_board`
- Reescribir `operational_task_card_summary` con CTEs set-based:
  - Un scan de `assigned_tasks` filtrado
  - JOIN lateral o agregaciones previas para assignees, labels, progress
  - `can_access` evaluado una vez por fila o pre-filtrado con política equivalente

### Ventajas

- Sin cambio de contrato frontend
- Rollout inmediato tras migración SQL
- Un solo endpoint

### Riesgos

- Función monolítica difícil de mantener
- RLS/SECURITY DEFINER debe revisarse línea a línea
- Mejora limitada si `can_access` sigue siendo por fila

### Impacto estimado (post-EXPLAIN)

- Payload: sin cambio (~mismo tamaño)
- Tiempo SQL: **−40 % a −60 %** si se eliminan subconsultas correlacionadas
- Requests: 0 cambio

---

## 4. Opción B — `get_operational_tasks_board_light` (recomendada tras medición)

### SQL conceptual

```sql
-- Pseudocódigo set-based (SECURITY DEFINER, search_path = '')
with visible as (
  select t.*
  from assigned_tasks t
  where t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
    and can_access_operational_task(t, 'view')
    -- + filtros p_area_id, p_search, p_label_ids, completed window
),
progress as (
  select task_id,
         count(*) filter (where status = 'done') as done,
         count(*) as total
  from task_steps
  where deleted_at is null
  group by task_id
),
primary_assignee as (
  select distinct on (ta.task_id)
         ta.task_id, p.id, p.full_name, p.avatar_url
  from task_assignees ta
  join profiles p on p.id = ta.profile_id
  where ta.status = 'active' and ta.is_primary
  order by ta.task_id, ta.created_at
),
labels_top3 as (
  select tla.task_id,
         jsonb_agg(
           jsonb_build_object('id', l.id, 'name', l.name, 'color_key', l.color_key)
           order by l.name
         ) filter (where rn <= 3) as labels
  from (
    select tla.*, row_number() over (partition by tla.task_id order by l.name) as rn
    from task_label_assignments tla
    join task_labels l on l.id = tla.label_id
  ) tla
  group by tla.task_id
)
select jsonb_build_object('tasks', coalesce(jsonb_agg(
  jsonb_build_object(
    'id', v.id,
    'title', v.title,
    'status', v.status,
    ...
    'primary_assignee', to_jsonb(pa.*),
    'labels', coalesce(lt.labels, '[]'),
    'steps_progress', jsonb_build_object('done', pr.done, 'total', pr.total),
    'permissions', get_operational_task_permissions(v)  -- o tabla derivada
  ) order by v.sort_position, v.created_at
), '[]'))
from visible v
left join progress pr on pr.task_id = v.id
left join primary_assignee pa on pa.task_id = v.id
left join labels_top3 lt on lt.task_id = v.id;
```

### Payload esperado (por tarjeta)

~400–800 bytes vs ~1.5–3 KB actual → **−50 % a −70 %** en `payload_bytes`.

### RLS y permisos

- Misma barrera: `can_access_operational_task` en CTE `visible`
- `SECURITY DEFINER` + `auth.uid()` como hoy
- Permisos mínimos calculados con `get_operational_task_permissions` **una vez** por fila visible (aceptable si n ≈ 80)
- No debilitar RLS en tablas base

### Riesgos

- Dos RPCs en transición
- Detalle debe seguir usando `get_operational_task_detail` completo
- Divergencia de shape si no se versiona el contrato

### Rollout con feature flag

```env
VITE_OPERATIONAL_BOARD_LIGHT_RPC=true
```

1. Fase 0: EXPLAIN + medición Semana 1
2. Fase 1: deploy SQL `board_light` en staging
3. Fase 2: frontend usa light solo para listado; detalle sin cambios
4. Fase 3: comparar funnel antes/después en gerente + operador
5. Fase 4: flag ON por defecto; deprecar path pesado en RPC antiguo

---

## 5. Recomendación

| Criterio | Opción A | Opción B |
|----------|:--------:|:--------:|
| Tiempo a valor | Medio | Medio-alto |
| Reducción payload | Baja | Alta |
| Riesgo regresión permisos | Medio | Medio |
| Mantenibilidad | Baja | Alta |
| Alineado a meta <1.5 s | Parcial | **Sí** |

**Recomendación:** implementar **Opción B** tras EXPLAIN en staging. Opción A como parche rápido solo si B retrasa > 1 sprint.

---

## 6. Criterios de aceptación (implementación futura)

- [ ] EXPLAIN documentado en `erp-performance-sprint-week1.md`
- [ ] Funnel: `request_ms` board RPC −50 % mínimo
- [ ] `payload_bytes` −40 % mínimo
- [ ] Permisos: usuario sin acceso no ve tarjeta (misma matriz que hoy)
- [ ] Detalle completo solo al abrir panel
- [ ] Feature flag + rollback en 1 deploy
