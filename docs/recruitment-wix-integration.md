# Integración Wix → Reclutamiento ERP

Conecta el formulario **Trabaja con Nosotros** de Wix con el módulo de Reclutamiento del ERP.

## Arquitectura

```
Wix Form / Automation
        │ POST JSON
        ▼
Edge Function: wix-recruitment-application
        │ service role
        ▼
RPC: create_recruitment_application_from_website
        ├─► recruitment_candidates (pipeline_status = applied)
        └─► notifications → RRHH / admin / gerencia
```

## Despliegue

1. Aplicar migración en Supabase:

   ```sql
   -- supabase/schema/124_recruitment_website_applications.sql
   ```

2. Configurar secrets:

   ```bash
   supabase secrets set WIX_RECRUITMENT_WEBHOOK_SECRET=<token-largo-opcional>
   ```

3. Desplegar la función:

   ```bash
   supabase functions deploy wix-recruitment-application --no-verify-jwt
   ```

4. URL del endpoint:

   ```
   https://<PROJECT_REF>.supabase.co/functions/v1/wix-recruitment-application
   ```

## Wix Automations (recomendado)

1. Wix → **Automations** → **New Automation**
2. Trigger: **Form submitted** → formulario *Trabaja con Nosotros*
3. Action: **Send HTTP request**
   - Method: `POST`
   - URL: endpoint de arriba
   - Body: JSON con los campos abajo (mapeo manual de cada campo del formulario)

### Payload oficial (JSON)

```json
{
  "first_name": "{{campo Nombre}}",
  "last_name": "{{campo Apellido}}",
  "phone": "{{campo Teléfono}}",
  "email": "{{campo Correo}}",
  "age": "{{campo Edad}}",
  "municipality": "{{campo Municipio}}",
  "education_level": "{{campo Escolaridad}}",
  "applied_position": "{{campo Puesto}}",
  "availability": "{{campo Disponibilidad}}",
  "available_start_date": "{{campo Fecha inicio}}",
  "salary_expectation": "{{campo Pretensión salarial}}",
  "has_experience": "{{campo Experiencia}}",
  "motivation": "{{campo Motivación}}",
  "attachment_url": "{{campo CV / archivo}}",
  "data_consent": true,
  "source": "website",
  "submitted_at": "{{fecha envío ISO}}"
}
```

### Campos obligatorios

| Campo | Descripción |
|-------|-------------|
| `first_name` + `last_name` (o `full_name`) | Nombre del candidato |
| `phone` | Teléfono |
| `applied_position` | Puesto al que aplica |
| `data_consent` | `true`, `"si"`, `"acepto"`, etc. |

## Webhook con secret (opcional)

Si Wix puede enviar headers personalizados:

- Header: `x-wix-recruitment-secret: <WIX_RECRUITMENT_WEBHOOK_SECRET>`
- Body: mismo JSON oficial

## Comportamiento en el ERP

- El candidato aparece en **Pipeline → Aplicó** (columna inicial).
- Fuente: **Website** (filtros del pipeline y dashboard).
- RRHH recibe notificación: *"Nuevo candidato recibido"*.
- Deep-link: `/hr?section=reclutamiento&tab=pipeline&candidateId={id}`
- Duplicados (mismo email o teléfono en 30 días): se actualiza el registro y se agrega evento al historial; no se crea notificación nueva.

## Vacante asociada

- Si existe una vacante abierta cuyo título coincide con `applied_position`, se vincula automáticamente.
- Si no hay coincidencia, se usa la vacante interna **Aplicaciones sitio web**.

## Prueba manual (curl)

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/wix-recruitment-application" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Ana",
    "last_name": "Pérez",
    "phone": "50255551234",
    "email": "ana@example.com",
    "applied_position": "Mesero",
    "availability": "Tiempo completo",
    "data_consent": true,
    "source": "website"
  }'
```

Respuesta esperada:

```json
{
  "success": true,
  "candidate_id": "...",
  "duplicate": false,
  "pipeline_status": "applied",
  "notification_count": 3
}
```

## Seguridad

- La función usa **service role** solo server-side.
- El RPC público rechaza llamadas con `auth.uid()` (usuarios autenticados del ERP).
- RLS de candidatos no se relaja; lectura solo para roles de reclutamiento.

## Logs

Revisar en Supabase → Edge Functions → Logs:

- `payload_received`
- `validation_failed`
- `candidate_created` / `candidate_updated`
- `rpc_failed`
