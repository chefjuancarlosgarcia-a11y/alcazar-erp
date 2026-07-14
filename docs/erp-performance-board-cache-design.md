# Diseño — Caché stale-while-revalidate del tablero

**Estado:** propuesta · **no implementar** en Semana 1  
**Objetivo:** vista con caché < 200 ms percibidos · sin librería pesada hasta revisar resultados

---

## 1. Requisitos

| Requisito | Detalle |
|-----------|---------|
| Clave | `userId + route + filtros serializados` |
| TTL | 30–60 s (stale); hard expiry opcional 5 min |
| SWR | Mostrar caché → refetch background → reemplazar si OK |
| Invalidación | Tras mutaciones (create, move, archive, labels) |
| Aislamiento | Nunca compartir entre usuarios |
| Sensibilidad | No persistir en `localStorage` indefinido; memoria de sesión preferida |

---

## 2. Estado actual (Semana 1 — parcial)

`useOperationalListQuery` en `useOperationalTasks.js` ya implementa **SWR en memoria de sesión**:

- `hasCachedData` / ref: no vacía lista en `refresh({ background: true })`
- `loading` solo en cold start
- `refreshing` + toolbar "Actualizando..."
- Errores con caché conservan datos

**Limitación:** la caché vive en el hook del componente montado. Al desmontar (cambiar Mi trabajo ↔ Tablero) se pierde.

---

## 3. Opciones comparadas

### A) Caché actual en hook (status quo + mejoras)

```text
TaskBoard mount → useOperationalTasksBoard → state local
Unmount → pierde caché
```

| Pros | Contras |
|------|---------|
| Cero dependencias | Sin persistencia entre rutas |
| Ya implementado SWR | Duplica fetch al volver al tablero |
| Simple | Sin dedupe global entre instancias |

**Mejora mínima:** elevar state a `WorkRoutes` context sin TTL explícito.

---

### B) Módulo Context / `boardCache.js`

```text
WorkModuleProvider
  └─ Map<cacheKey, { data, syncedAt, filters }>
TaskBoard / MyWork leen por clave
TTL 45s: si fresh → skip initial fetch, background refresh
```

| Pros | Contras |
|------|---------|
| Sin nueva dependencia | Invalidación manual |
| Comparte entre vistas Trabajo | Más código propio |
| Clave usuario+filtros explícita | Sin devtools estándar |

**Estimación:** −1 request al alternar Mi trabajo ↔ Tablero; perceived < 200 ms si TTL hit.

---

### C) TanStack Query gradual

```text
useQuery({
  queryKey: ['board', userId, filters],
  queryFn: getOperationalTasksBoard,
  staleTime: 45_000,
  gcTime: 300_000,
  placeholderData: keepPreviousData
})
```

| Pros | Contras |
|------|---------|
| SWR, dedupe, invalidación estándar | +~13 KB gzip; curva aprendizaje |
| `queryClient.invalidateQueries` tras mutaciones | Migración gradual de otros módulos |
| Devtools en dev | Riesgo de scope creep en sprint |

---

## 4. Matriz de decisión

| Criterio | Hook | Context | TanStack Query |
|----------|:----:|:-------:|:--------------:|
| Tiempo implementación | ✅ Listo | 1–2 días | 2–4 días |
| < 200 ms perceived (revisit) | ❌ | ✅ | ✅ |
| Sin dependencia nueva | ✅ | ✅ | ❌ |
| Invalidación mutaciones | Manual OK | Manual | ✅ |
| Escalar a Inventario/RRHH | ❌ | Medio | ✅ |

---

## 5. Recomendación definitiva

**Fase 1 (post-Semana 1):** extender **Opción B — `boardCache.js` + provider en `WorkRoutes`**

- Razón: cumple TTL y clave sin dependencia; alcance acotado al módulo Trabajo
- TTL 45 s; clave `board:${userId}:${areaId}:${search}:${labelIds}:...`
- API: `getBoardCache(key)`, `setBoardCache(key, data)`, `invalidateBoardCache(prefix)`

**Fase 2 (si ≥3 módulos necesitan SWR):** adoptar **TanStack Query** con adapter sobre `operationalTasksService` — no antes de medir Semana 1.

**No usar `localStorage`** para filas del tablero (permisos, títulos, assignees).

---

## 6. Plan de invalidación

| Evento | Acción |
|--------|--------|
| `moveOperationalTask` | `invalidateBoardCache('board:')` |
| `quickCreate` | idem |
| `archive` / `restore` | idem |
| Cambio filtros | nueva clave (automático) |
| Logout | `clearAllBoardCache()` |
| Focus refresh (cooldown OK) | background refetch, actualiza entrada |

---

## 7. Métricas de éxito (implementación futura)

- Segunda visita al tablero < 200 ms hasta primer paint (con caché TTL hit)
- 0 regresiones empty state falso
- Funnel: −1 cold `get_operational_tasks_board` al alternar sub-rutas Trabajo
