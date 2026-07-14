# Especificación implementable — `get_operational_tasks_board_light`

**Estado:** listo para revisión post-EXPLAIN · **no implementar** hasta aprobar plan  
**Meta:** RPC < 1 s · ideal 300–500 ms · tablero cold < 1.5 s

---

## 1. Contrato RPC

```sql
create or replace function public.get_operational_tasks_board_light(
  p_area_id text default null,
  p_assignee_id uuid default null,
  p_search text default null,
  p_include_cancelled boolean default false,
  p_completed_days integer default 7,
  p_include_old_completed boolean default false,
  p_label_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
```

**Respuesta:**

```json
{
  "tasks": [
    {
      "id": "…",
      "title": "…",
      "status": "in_progress",
      "priority": "high",
      "due_at": "…",
      "waiting_reason": null,
      "sort_position": 1000,
      "updated_at": "…",
      "primary_assignee": {
        "profile_id": "…",
        "full_name": "…",
        "avatar_url": "…"
      },
      "labels": [
        { "id": "…", "name": "…", "color_key": "teal" }
      ],
      "pending_steps": 3,
      "completed_steps": 2,
      "permissions": {
        "can_edit": true,
        "can_move": true,
        "can_archive": true
      }
    }
  ]
}
```

**No incluye:** objective, expected_result, description, work_summary texto, assignees[], watchers, comments, attachments, work_plan, activity, permisos detallados.

---

## 2. SQL propuesto (cercano a producción)

```sql
declare
  v_actor_id uuid := auth.uid();
  v_role text;
  v_area text;
  v_is_executive boolean;
  v_is_manager boolean;
  v_search text := nullif(trim(lower(coalesce(p_search, ''))), '');
  v_completed_days integer := greatest(coalesce(p_completed_days, 7), 1);
begin
  if v_actor_id is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select
    public.normalize_profile_role(public.current_profile_role()),
    coalesce(p.area_id, ''),
    public.is_operational_task_executive_reader(),
    public.is_assigned_task_manager()
  into v_role, v_area, v_is_executive, v_is_manager
  from public.profiles p
  where p.id = v_actor_id;

  return (
    with base as (
      select t.*
      from public.assigned_tasks t
      where t.task_source = 'operational'
        and t.deleted_at is null
        and t.archived_at is null
        and (p_include_cancelled or t.status <> 'cancelled')
        and (
          t.status <> 'completed'
          or p_include_old_completed
          or t.completed_at >= now() - make_interval(days => v_completed_days)
          or (t.completed_at is null and t.updated_at >= now() - make_interval(days => v_completed_days))
        )
        and (p_area_id is null or t.area_id = p_area_id)
        and (
          p_assignee_id is null
          or exists (
            select 1 from public.task_assignees ta
            where ta.task_id = t.id
              and ta.profile_id = p_assignee_id
              and ta.status = 'active'
          )
        )
        and (
          v_search is null
          or lower(t.title) like '%' || v_search || '%'
        )
        and (
          p_label_ids is null
          or cardinality(p_label_ids) = 0
          or exists (
            select 1 from public.task_label_assignments tla
            where tla.task_id = t.id and tla.label_id = any(p_label_ids)
          )
        )
    ),
    visible as (
      select b.*
      from base b
      where
        -- Set-based visibility (equivalente a can_access, sin función por fila)
        v_is_executive
        or b.created_by = v_actor_id
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = b.id
            and ta.profile_id = v_actor_id
            and ta.status = 'active'
        )
        or (
          v_is_manager and v_role not in ('supervisor', 'recursos_humanos', 'encargado_area')
        )
        or (
          v_is_manager and v_role = 'supervisor' and (
            b.created_by = v_actor_id
            or exists (
              select 1
              from public.task_assignees ta
              join public.profiles p on p.id = ta.profile_id
              where ta.task_id = b.id
                and ta.status = 'active'
                and p.supervisor_profile_id = v_actor_id
            )
          )
        )
        or (
          v_is_manager and v_role = 'recursos_humanos'
          and (
            coalesce(b.area_id, '') = 'administracion'
            or coalesce(b.category, '') in ('Recursos Humanos', 'Capacitación')
          )
        )
        or (
          v_is_manager and v_role = 'encargado_area'
          and (v_area = '' or coalesce(b.area_id, '') = '' or b.area_id = v_area)
        )
    ),
    step_stats as (
      select
        s.task_id,
        count(*) filter (where not s.completed)::int as pending_steps,
        count(*) filter (where s.completed)::int as completed_steps
      from public.task_steps s
      join visible v on v.id = s.task_id
      where s.deleted_at is null
      group by s.task_id
    ),
    primary_assignee as (
      select distinct on (ta.task_id)
        ta.task_id,
        ta.profile_id,
        coalesce(p.full_name, '') as full_name,
        p.avatar_url
      from public.task_assignees ta
      join visible v on v.id = ta.task_id
      join public.profiles p on p.id = ta.profile_id
      where ta.status = 'active'
      order by ta.task_id,
        case ta.assignment_role when 'primary' then 0 else 1 end,
        p.full_name
    ),
    labels_ranked as (
      select
        tla.task_id,
        l.id,
        l.name,
        l.color_key,
        row_number() over (partition by tla.task_id order by l.name) as rn
      from public.task_label_assignments tla
      join visible v on v.id = tla.task_id
      join public.task_labels l on l.id = tla.label_id
      where l.deleted_at is null and l.archived_at is null
    ),
    labels_top3 as (
      select
        task_id,
        jsonb_agg(
          jsonb_build_object('id', id, 'name', name, 'color_key', color_key)
          order by name
        ) as labels
      from labels_ranked
      where rn <= 3
      group by task_id
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'title', v.title,
        'status', v.status,
        'priority', v.priority,
        'due_at', v.due_at,
        'waiting_reason', v.waiting_reason,
        'sort_position', v.sort_position,
        'updated_at', v.updated_at,
        'primary_assignee', case when pa.task_id is null then null else jsonb_build_object(
          'profile_id', pa.profile_id,
          'full_name', pa.full_name,
          'avatar_url', pa.avatar_url
        ) end,
        'labels', coalesce(lt.labels, '[]'::jsonb),
        'pending_steps', coalesce(ss.pending_steps, 0),
        'completed_steps', coalesce(ss.completed_steps, 0),
        'permissions', jsonb_build_object(
          'can_edit', public.can_mutate_operational_task(v),
          'can_move', public.can_mutate_operational_task(v),
          'can_archive', public.can_mutate_operational_task(v) and v.archived_at is null
        )
      )
      order by v.sort_position asc, v.created_at desc
    ), '[]'::jsonb)
    from visible v
    left join step_stats ss on ss.task_id = v.id
    left join primary_assignee pa on pa.task_id = v.id
    left join labels_top3 lt on lt.task_id = v.id
  );
end;
```

### Notas de implementación

1. **Búsqueda:** en light, solo `title` en primer paint. Búsqueda en objective/steps queda para RPC actual o detalle (decisión producto).
2. **Permisos:** `can_mutate_operational_task` sigue siendo **por fila visible** (3 booleans vs 15+ en RPC actual). Es aceptable si N ≈ 80; si EXPLAIN lo marca, cachear mutación con misma lógica set-based.
3. **Validación seguridad:** comparar matriz rol × visibilidad contra `can_access_operational_task` en tests antes de deploy.

---

## 3. Seguridad — comparación A / B / C

| Opción | Descripción | Velocidad | Seguridad | Recomendación |
|--------|-------------|-----------|-----------|---------------|
| **A** | `can_access_operational_task(t)` en WHERE y otra vez en permissions | Lenta (2N+) | Referencia actual | Baseline |
| **B** | Materializar IDs visibles una vez con misma función | Media | Equivalente si misma función | Puente |
| **C** | SECURITY DEFINER + contexto actor calculado 1 vez + joins set-based | **Rápida** | Equivalente **si** la CTE `visible` replica 176 línea a línea | **✅ Elegida** |

**No hacer:** `SET row_security = off` ni leer `assigned_tasks` sin filtro `visible`.

**Pruebas obligatorias:**

| Caso | Usuario | Debe ver | No debe ver |
|------|---------|----------|-------------|
| Operador asignado | colaborador | sus tarjetas | tareas de otra área |
| Supervisor | supervisor | equipo supervisado | otras áreas |
| Encargado área | encargado_area | su área | otras áreas |
| RRHH | recursos_humanos | admin/capacitación | operación cocina |
| Gerente | gerente | tablero completo | archivadas/deleted |
| No asignado | operador random | 0 filas | tareas ajenas |

Script: para 20 tareas muestreadas, `visible` light = filtro `can_access` actual.

---

## 4. Índices (solo si EXPLAIN confirma Seq Scan)

| Índice | Cuándo |
|--------|--------|
| `assigned_tasks (task_source, deleted_at, archived_at, status)` WHERE operational | Seq scan en `base` |
| `task_assignees (task_id, profile_id)` WHERE status = 'active' | Nested loop assignees |
| `task_steps (task_id)` WHERE deleted_at IS NULL | Agregación steps |
| `task_label_assignments (task_id, label_id)` | Filtro etiquetas |

**No crear** hasta pegar planes B/C/D.

---

## 5. Frontend

```env
# frontend/.env
VITE_OPERATIONAL_BOARD_LIGHT_RPC=false
```

```javascript
// operationalTasksService.js
const RPC_NAME = import.meta.env.VITE_OPERATIONAL_BOARD_LIGHT_RPC === "true"
  ? "get_operational_tasks_board_light"
  : "get_operational_tasks_board"
```

**Cambios mínimos:**

- `TaskCard.jsx`: leer `pending_steps` / `completed_steps` si existen; fallback a `steps_progress`
- Sin cambio en `TaskDetailPanel` (sigue `get_operational_task_detail`)
- `erpPerf`: mismo nombre lógico `rpc:get_operational_tasks_board` o alias `board_light`

**Rollback:** flag `false` → RPC anterior, sin migración de datos.

---

## 6. Medición antes / después

| Métrica | Antes (7.79 s total) | Objetivo light |
|---------|---------------------:|---------------:|
| `max_request_ms` board RPC | ~6500–7500 ms (medir) | < 1000 ms |
| `payload_bytes` | medir | −50 % |
| `row_count` | igual | igual |
| `interactive_ms` tablero | medir post-fix perf | < 1500 ms |

Comandos:

```js
__ERP_PERF__.clear()
__ERP_PERF__.startRound({ module: "trabajo-tablero", scenario: "cold" })
// recargar tablero
__ERP_PERF__.boardRpc()
__ERP_PERF__.funnel()
__ERP_PERF__.waterfall()
```

---

## 7. Archivos a crear (fase implementación)

| Archivo | Acción |
|---------|--------|
| `supabase/schema/184_operational_tasks_board_light.sql` | RPC + grants |
| `supabase/tests/verify_board_light_permissions.sql` | matriz permisos |
| `frontend/src/services/operationalTasksService.js` | flag RPC |
| `frontend/src/pages/tasks/TaskCard.jsx` | campos light |
| `docs/erp-performance-board-light-design.md` | este doc |

---

## 8. Estimación de reducción

| Componente eliminado | Por tarjeta hoy | Light |
|---------------------|----------------:|------:|
| `can_access` en WHERE | 1× | 0× (join) |
| `operational_task_card_summary` | 1× | 0× |
| `get_task_work_card_summary` | 1× | 0× (agg steps) |
| `task_labels_for_task` | 1× | 0× (top 3 agg) |
| `assignees` jsonb_agg completo | 1× | 0× |
| `get_operational_task_permissions` (15 checks) | 1× | 3 checks |
| objective / expected_result en payload | sí | no |

**Estimación conservadora:** RPC **−70 % a −85 %** si N ≥ 50.
