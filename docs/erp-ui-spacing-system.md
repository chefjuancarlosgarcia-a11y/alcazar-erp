# ERP UI Spacing System v1.0 — El Gran Alcázar

**Estado:** obligatorio para todo cambio de UI/UX del ERP.  
**Referencia técnica:** `frontend/src/styles/erp-ui-spacing.css`  
**Regla Cursor:** `.cursor/rules/erp-ui-spacing-system.mdc`

Este ERP es una herramienta operativa diaria, no una landing page.

## Prioridades

1. Claridad  
2. Escaneo rápido  
3. Consistencia  
4. Menos scroll innecesario  
5. Acciones visibles  
6. Densidad controlada  
7. Responsive real  

**Desktop** = información · **Tablet** = equilibrio · **Smartphone** = acción rápida

---

## 1. Grid base

Usar **solo** múltiplos de 8:

| Token | Valor |
|-------|-------|
| micro | 4px |
| related | 8px |
| component | 16px |
| group | 24px |
| section | 32px |
| block | 48px |
| area | 64px |

**Prohibido:** 3, 5, 7, 11, 13, 17, 19, 27px (corregir al múltiplo de 8 más cercano).

---

## 2. Desktop (1440px+)

- Sidebar: **240px**
- Contenido: **max-width 1600px**
- Padding contenido: **24px** lateral y superior
- Entre secciones: **32px**
- Entre componentes: **16px**
- Entre grupos de filtros: **24px**
- Elementos relacionados: **8px**
- Microespaciado: **4px**

---

## 3. Tablet (768px–1024px)

- Sidebar: colapsada o drawer
- Padding pantalla: **16px**
- Gap cards: **16px**
- Grid: **máx. 2 columnas**
- KPIs: **2 columnas**
- Formularios: **máx. 2 columnas**
- Inputs / botones / targets táctiles: **48px** mínimo

---

## 4. Smartphone (320px–767px)

- Padding lateral y superior: **16px**
- Gap vertical: **16px** · gap pequeño: **8px**
- Cards: **1 columna**, padding **16px**, radius **12px**
- Formularios: **1 columna siempre**
- Inputs / dropdowns / botones: **52px**
- KPIs: **máx. 2 por fila**
- Tablas: evitar tabla completa → filas como cards

---

## 5. Cards

| Tipo | Padding |
|------|---------|
| Estándar / KPI | 16px |
| Formulario / reporte | 24px |

- Border radius: **12px**
- Gap interno: **8px** (relacionados) · **16px** (bloques)
- Borde sutil, fondo oscuro diferenciado
- Acciones visibles (footer o esquina superior derecha)

---

## 6. Formularios

| Breakpoint | Columnas máx. |
|------------|---------------|
| Desktop | 3 |
| Tablet | 2 |
| Mobile | 1 |

- Label → input: **8px**
- Input → input: **16px**
- Grupo → grupo: **24px**
- Altura input: **44px** desktop · **48px** tablet · **52px** mobile
- Textarea mínimo: **120px**
- Agrupar por secciones claras (general, contacto, comercial, operativa)

---

## 7. Tablas

Solo para auditoría, historial, movimientos, reportes densos.

| Elemento | Desktop |
|----------|---------|
| Header | 52px |
| Fila | 48px |
| Celda | 12px 16px |
| Acciones | 40px mínimo |

Tablet: menos columnas. Mobile: **card por fila**, no tabla completa.

---

## 8. Dashboards

Estructura: **Header → KPIs → Filtros → Contenido**

- KPI gap: **16px**
- Desktop: 4–6 KPIs/fila · Tablet: 2 · Mobile: 2 máx.
- Ancho KPI desktop: 180–220px cuando aplique

---

## 9. Listas → preferir cards

Entidades (proveedores, colaboradores, recetas, checklists, tareas, mesas, productos, áreas, órdenes):

| Breakpoint | Columnas |
|------------|----------|
| Desktop | 3–4 |
| Tablet | 2 |
| Mobile | 1 |

Cada card: título, código, 2–4 datos clave, badges, acciones visibles.

---

## 10. Filtros

Arriba del contenido. Desktop en fila (gap 16–24px). Tablet 2 cols. Mobile: buscador arriba, filtros secundarios colapsables.

Altura: **44 / 48 / 52px** (desktop / tablet / mobile).

---

## 11. POS

Cards grandes, botones táctiles (≥48px), categorías visibles, orden claro, alto contraste. **Velocidad > densidad > estética.**

---

## 12. RRHH / Asistencia

KPIs arriba, cards para alertas, tablas solo en detalle, badges de estado. No ocultar problemas operativos.

---

## 13. Inventario

**Cards:** proveedores, productos, recetas, áreas, categorías.  
**Tablas:** movimientos, historial, OC, auditoría, kardex.

---

## 14. Estilo visual

Tema oscuro actual. SaaS operativo (Linear / Stripe / Notion / Odoo moderno).

- Sí: bordes sutiles, badges, teal/verde positivo, amarillo/naranja advertencia, rojo solo riesgo
- No: sombras exageradas, gradientes innecesarios, bordes gruesos, listas tipo Excel, formularios eternos

---

## 15. Regla de oro

| Token | Uso |
|-------|-----|
| 4px | micro |
| 8px | relacionados |
| 16px | componentes |
| 24px | grupos |
| 32px | secciones |
| 48px | bloques |
| 64px | áreas |

---

## 16. Checklist antes de entregar UI

1. ¿Múltiplos de 8?  
2. ¿Desktop / tablet / mobile?  
3. ¿Cards en lugar de listas infinitas?  
4. ¿Formularios agrupados?  
5. ¿Botones táctiles?  
6. ¿Escaneo rápido?  
7. ¿Mobile sin tablas completas?  
8. ¿KPIs arriba?  
9. ¿Filtros antes del contenido?  
10. ¿Sensación ERP SaaS moderno?

Si no cumple, corregir antes de entregar.
