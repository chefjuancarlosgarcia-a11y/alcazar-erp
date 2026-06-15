# Catering — Arquitectura Fase 2 (diseño)

Documento de diseño. **No implementado.** Describe las tablas que extienden el pipeline comercial iniciado en Fase 1 / 1.5.

**Prerrequisitos aplicados:**
- `082_catering_requests.sql` — solicitudes / leads
- `083_catering_pipeline_phase_1_5.sql` — campos comerciales y RPCs de pipeline

---

## Visión del embudo completo

```
Wix Form / ERP manual
        ↓
catering_requests (lead)
        ↓
Seguimiento comercial (Fase 1.5)
        ↓
catering_quotes + catering_quote_items
        ↓
Negociación / aprobación
        ↓
catering_events (+ staff + equipment)
        ↓
catering_payments
        ↓
Facturación / POS (opcional)
```

---

## 1. `catering_quotes`

### Propósito

Cotización formal vinculada a una solicitud. Una solicitud puede tener varias versiones de cotización (v1, v2 revisada).

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `request_id` | uuid FK → `catering_requests(id)` | Solicitud origen |
| `quote_number` | text UNIQUE | Ej. `CAT-2026-00042` |
| `version` | integer | Default 1 |
| `status` | text | `draft`, `sent`, `accepted`, `rejected`, `expired` |
| `valid_until` | date | Vigencia de la propuesta |
| `subtotal` | numeric(12,2) | |
| `discount_amount` | numeric(12,2) | |
| `tax_amount` | numeric(12,2) | |
| `total_amount` | numeric(12,2) | |
| `currency` | text | Default `GTQ` |
| `notes` | text | Condiciones comerciales |
| `pdf_url` | text | URL storage del PDF generado |
| `sent_at` | timestamptz | Cuándo se envió al cliente |
| `accepted_at` | timestamptz | |
| `created_by` / `updated_by` | uuid FK → profiles | |
| `created_at` / `updated_at` | timestamptz | |

### Relaciones

- `catering_requests` 1 → N `catering_quotes`
- `catering_quotes` 1 → N `catering_quote_items`
- Al aceptar cotización: actualizar `catering_requests.conversion_status = 'approved'` y preparar `catering_events`

### Índices recomendados

- `(request_id, version desc)`
- `(status, created_at desc)`
- `(quote_number)` UNIQUE
- `(valid_until)` WHERE status = 'sent'

---

## 2. `catering_quote_items`

### Propósito

Líneas de detalle de la cotización: menús, servicio, mobiliario, personal, etc.

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `quote_id` | uuid FK → `catering_quotes(id)` ON DELETE CASCADE | |
| `sort_order` | integer | Orden en PDF |
| `item_type` | text | `menu`, `service`, `equipment`, `staff`, `other` |
| `description` | text NOT NULL | |
| `quantity` | numeric(10,2) | Default 1 |
| `unit` | text | `pax`, `hour`, `unit`, `event` |
| `unit_price` | numeric(12,2) | |
| `line_total` | numeric(12,2) | Calculado o almacenado |
| `notes` | text | |
| `created_at` | timestamptz | |

### Relaciones

- Pertenece a una `catering_quotes`
- Opcional futuro: FK a catálogo de productos POS / recetas

### Índices recomendados

- `(quote_id, sort_order)`
- `(quote_id, item_type)`

---

## 3. `catering_events`

### Propósito

Evento confirmado en operaciones: fecha, lugar, logística, enlace a cotización aceptada.

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `request_id` | uuid FK → `catering_requests(id)` | |
| `quote_id` | uuid FK → `catering_quotes(id)` | Cotización aceptada |
| `event_code` | text UNIQUE | Ej. `EVT-2026-0018` |
| `title` | text | Nombre del evento |
| `event_date` | date NOT NULL | |
| `event_time` | time | |
| `event_end_time` | time | |
| `event_location` | text | |
| `guest_count` | integer | |
| `status` | text | `planned`, `confirmed`, `in_progress`, `completed`, `cancelled` |
| `operations_notes` | text | Instrucciones cocina / logística |
| `customer_name` | text | Snapshot del cliente |
| `customer_phone` | text | |
| `customer_email` | text | |
| `assigned_coordinator` | uuid FK → profiles | |
| `created_by` / `updated_by` | uuid | |
| `created_at` / `updated_at` | timestamptz | |

### Relaciones

- 1 `catering_requests` → 0..1 `catering_events` activo (o N histórico si se permite reprogramación)
- 1 `catering_quotes` → 0..1 `catering_events`
- 1 `catering_events` → N `catering_event_staff`
- 1 `catering_events` → N `catering_event_equipment`
- 1 `catering_events` → N `catering_payments`

### Índices recomendados

- `(event_date, status)`
- `(request_id)`
- `(quote_id)`
- `(assigned_coordinator, event_date)`
- `(event_code)` UNIQUE

---

## 4. `catering_event_staff`

### Propósito

Personal asignado al evento: meseros, cocineros, coordinador, etc.

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `event_id` | uuid FK → `catering_events(id)` ON DELETE CASCADE | |
| `employee_id` | uuid FK → profiles | Colaborador |
| `role_label` | text | `mesero`, `cocinero`, `coordinador` |
| `scheduled_start` | timestamptz | |
| `scheduled_end` | timestamptz | |
| `confirmed` | boolean | Default false |
| `notes` | text | |
| `created_at` | timestamptz | |

### Relaciones

- N staff por evento
- Opcional: cruce con `employee_schedules` para evitar conflictos de horario

### Índices recomendados

- `(event_id)`
- `(employee_id, scheduled_start)`
- `(event_id, role_label)`

---

## 5. `catering_event_equipment`

### Propósito

Mobiliario, vajilla, lonas, calentadores u otros recursos físicos asignados al evento.

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `event_id` | uuid FK → `catering_events(id)` ON DELETE CASCADE | |
| `item_name` | text NOT NULL | |
| `quantity` | integer | Default 1 |
| `unit` | text | `unit`, `set`, `table` |
| `status` | text | `reserved`, `loaded`, `returned`, `damaged` |
| `notes` | text | |
| `created_at` / `updated_at` | timestamptz | |

### Relaciones

- N equipos por evento
- Futuro: FK a inventario / activos fijos si aplica

### Índices recomendados

- `(event_id, status)`
- `(event_id, item_name)`

---

## 6. `catering_payments`

### Propósito

Anticipos, abonos y saldo del evento. Base para facturación y conciliación.

### Campos principales

| Campo | Tipo | Notas |
|-------|------|--------|
| `id` | uuid PK | |
| `event_id` | uuid FK → `catering_events(id)` | |
| `quote_id` | uuid FK → `catering_quotes(id)` | Referencia de monto total |
| `payment_type` | text | `deposit`, `partial`, `final`, `refund` |
| `amount` | numeric(12,2) NOT NULL | |
| `currency` | text | Default `GTQ` |
| `payment_method` | text | `cash`, `transfer`, `card`, `check` |
| `reference_number` | text | No. transferencia / voucher |
| `status` | text | `pending`, `confirmed`, `failed`, `refunded` |
| `paid_at` | timestamptz | |
| `notes` | text | |
| `recorded_by` | uuid FK → profiles | |
| `created_at` / `updated_at` | timestamptz | |

### Relaciones

- N pagos por evento
- Suma de pagos `confirmed` vs `catering_quotes.total_amount` = saldo pendiente
- Futuro: enlace a sesión de caja POS / factura electrónica

### Índices recomendados

- `(event_id, paid_at desc)`
- `(event_id, status)`
- `(quote_id)`
- `(payment_type, status)`

---

## RPCs sugeridos (Fase 2 — no implementar aún)

| RPC | Descripción |
|-----|-------------|
| `create_catering_quote_from_request` | Genera cotización borrador desde solicitud |
| `send_catering_quote` | Marca enviada, genera PDF, dispara notificación |
| `accept_catering_quote` | Aceptación cliente → crea evento |
| `convert_catering_request_to_event` | Atajo solicitud aprobada → evento |
| `record_catering_payment` | Registra abono |
| `get_catering_event_detail` | Detalle operativo completo |

---

## Permisos (borrador)

Reutilizar `can_manage_catering_requests()` para comercial. Considerar rol futuro `catering_coordinator` para operaciones de evento (staff/equipment) con lectura de cotizaciones aprobadas.

---

## Archivos relacionados

| Archivo | Estado |
|---------|--------|
| `supabase/schema/082_catering_requests.sql` | Implementado |
| `supabase/schema/083_catering_pipeline_phase_1_5.sql` | Propuesto Fase 1.5 |
| `supabase/schema/084_catering_quotes.sql` | Futuro |
| `supabase/schema/085_catering_events.sql` | Futuro |
