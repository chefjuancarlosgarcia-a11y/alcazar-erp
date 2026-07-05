import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import {
  getBillingMonitoringSummary,
  getBillingSettings,
  listBillingLegalEntities,
  listBillingProviderConfigs,
  setBillingSettings,
  testBillingConnection,
  upsertBillingProviderConfig
} from "../../services/billing/billingSettingsService"
import {
  BILLING_CONNECTION_STATUS,
  BILLING_ENVIRONMENTS,
  BILLING_PROVIDER_CODES,
  FELPLEX_GT_DEFAULT_BASE_URLS
} from "../../utils/billingConstants"
import { canManageBillingSettings } from "../../utils/billingPermissions"
import "../inventory/MigrationModeBanner.css"
import "./BillingSettingsPanel.css"

const VAULT_SECRET_BY_ENV = {
  [BILLING_ENVIRONMENTS.STAGE]: "billing_felplex_gt_stage",
  [BILLING_ENVIRONMENTS.PRODUCTION]: "billing_felplex_gt_production"
}

function connectionLabel(status) {
  if (status === BILLING_CONNECTION_STATUS.HEALTHY) return "Conectado"
  if (status === BILLING_CONNECTION_STATUS.ERROR) return "Error"
  if (status === BILLING_CONNECTION_STATUS.DEGRADED) return "Degradado"
  return "Sin prueba"
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString("es-GT")
}

export default function BillingSettingsPanel() {
  const { user } = useAuth()
  const canManage = useMemo(() => canManageBillingSettings(user), [user])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const [settings, setSettings] = useState(null)
  const [monitoring, setMonitoring] = useState(null)
  const [legalEntities, setLegalEntities] = useState([])

  const [environment, setEnvironment] = useState(BILLING_ENVIRONMENTS.STAGE)
  const [entityId, setEntityId] = useState("")
  const [configId, setConfigId] = useState("")

  const providerStatus = monitoring?.providers?.[0] || null
  const documentCounts = monitoring?.document_counts?.[0] || null

  useEffect(() => {
    if (!canManage) return
    loadAll()
  }, [canManage])

  async function loadAll() {
    setLoading(true)
    setError("")
    const [settingsRes, configsRes, monitoringRes, entitiesRes] = await Promise.all([
      getBillingSettings(),
      listBillingProviderConfigs(),
      getBillingMonitoringSummary(),
      listBillingLegalEntities()
    ])
    setLoading(false)

    if (settingsRes.error) {
      setError(settingsRes.error)
      return
    }

    setSettings(settingsRes.data)
    setMonitoring(monitoringRes.data)
    setLegalEntities(entitiesRes.data || [])

    const env = settingsRes.data?.environment || BILLING_ENVIRONMENTS.STAGE
    setEnvironment(env)

    const match = (configsRes.data || []).find(
      (row) => row.provider_code === BILLING_PROVIDER_CODES.FELPLEX_GT && row.environment === env
    )
    if (match) {
      setConfigId(match.id)
      setEntityId(match.entity_id || "")
    }
  }

  if (!canManage) return null

  async function handleSaveConfig(event) {
    event.preventDefault()
    setBusy(true)
    setMessage("")
    setError("")

    const result = await upsertBillingProviderConfig({
      id: configId || undefined,
      provider_code: BILLING_PROVIDER_CODES.FELPLEX_GT,
      environment,
      entity_id: entityId.trim(),
      vault_secret_name: VAULT_SECRET_BY_ENV[environment],
      base_url: FELPLEX_GT_DEFAULT_BASE_URLS[environment],
      is_default: true,
      is_active: true,
      issuer_settings: { iva_regime: "GEN" }
    })

    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.data?.id) setConfigId(result.data.id)
    setMessage("Configuracion del proveedor guardada.")
    await loadAll()
  }

  async function handleToggleEnabled(nextEnabled) {
    setBusy(true)
    setMessage("")
    setError("")
    const result = await setBillingSettings({ enabled: nextEnabled })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSettings(result.data)
    setMessage(nextEnabled ? "Modulo habilitado (sin emision en Fase 0)." : "Modulo desactivado.")
  }

  async function handleTestConnection() {
    setBusy(true)
    setMessage("")
    setError("")
    const result = await testBillingConnection({
      providerCode: BILLING_PROVIDER_CODES.FELPLEX_GT,
      environment
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      await loadAll()
      return
    }
    setMessage(
      `Conexion exitosa${result.data?.credits != null ? ` · ${result.data.credits} creditos` : ""} · ${result.data?.duration_ms ?? "—"} ms`
    )
    await loadAll()
  }

  return (
    <section className="settings-panel migration-mode-settings billing-settings-panel">
      <header>
        <h3>Facturacion electronica</h3>
        <p>
          Fundacion Fase 0 — configuracion y monitoreo del certificador. La emision FEL se activara en una fase posterior.
        </p>
      </header>

      {loading && <p className="migration-mode-meta">Cargando configuracion...</p>}
      {message && <p className="migration-mode-feedback">{message}</p>}
      {error && <p className="migration-mode-feedback warning">{error}</p>}

      {!loading && settings && (
        <>
          <div className="billing-status-grid">
            <article className="settings-card billing-status-card">
              <p className="settings-eyebrow">Estado del modulo</p>
              <strong>{settings.enabled ? "Habilitado" : "Desactivado"}</strong>
              <span>Fase {settings.phase ?? 0} · Emision: {settings.emission_enabled ? "activa" : "inactiva"}</span>
              <div className="billing-inline-actions">
                <button type="button" disabled={busy} onClick={() => handleToggleEnabled(!settings.enabled)}>
                  {settings.enabled ? "Desactivar modulo" : "Habilitar modulo"}
                </button>
              </div>
            </article>

            <article className="settings-card billing-status-card">
              <p className="settings-eyebrow">Proveedor</p>
              <strong>FELplex Guatemala</strong>
              <span>
                Adapter v{providerStatus?.adapter_version || "1.0.0"} · {environment}
              </span>
              <span>Estado: {connectionLabel(providerStatus?.connection_status)}</span>
            </article>

            <article className="settings-card billing-status-card">
              <p className="settings-eyebrow">Ultima prueba</p>
              <strong>{providerStatus?.last_test_success === true ? "Exitosa" : providerStatus?.last_test_success === false ? "Fallida" : "—"}</strong>
              <span>{formatDate(providerStatus?.last_test_at)}</span>
              <span>Duracion: {providerStatus?.last_test_duration_ms != null ? `${providerStatus.last_test_duration_ms} ms` : "—"}</span>
            </article>

            <article className="settings-card billing-status-card">
              <p className="settings-eyebrow">Creditos / documentos</p>
              <strong>{providerStatus?.last_known_credits ?? "—"}</strong>
              <span>Pendientes: {documentCounts?.pending_count ?? 0}</span>
              <span>Fallidos: {documentCounts?.failed_count ?? 0}</span>
            </article>
          </div>

          {providerStatus?.last_test_error_summary && (
            <p className="migration-mode-meta">
              Ultimo error: {providerStatus.last_test_error_summary}
            </p>
          )}

          {providerStatus?.last_successful_connection_at && (
            <p className="migration-mode-meta">
              Ultima conexion exitosa: {formatDate(providerStatus.last_successful_connection_at)}
            </p>
          )}

          <form className="settings-card billing-config-form" onSubmit={handleSaveConfig}>
            <p className="settings-eyebrow">Configuracion FELplex</p>
            <h4>Conexion al certificador</h4>

            {legalEntities.length > 0 && (
              <p className="migration-mode-meta">
                Entidad legal: {legalEntities.find((e) => e.is_default)?.legal_name || legalEntities[0]?.legal_name}
              </p>
            )}

            <div className="billing-form-grid">
              <label>
                Entorno
                <select value={environment} disabled={busy} onChange={(event) => setEnvironment(event.target.value)}>
                  <option value={BILLING_ENVIRONMENTS.STAGE}>Stage (pruebas)</option>
                  <option value={BILLING_ENVIRONMENTS.PRODUCTION}>Produccion</option>
                </select>
              </label>
              <label>
                ID empresa FELplex
                <input
                  required
                  value={entityId}
                  disabled={busy}
                  onChange={(event) => setEntityId(event.target.value)}
                  placeholder="ID numerico de entidad"
                />
              </label>
              <label>
                Secreto Vault
                <input
                  readOnly
                  value={VAULT_SECRET_BY_ENV[environment]}
                  title="Configura este secreto en Supabase Vault"
                />
              </label>
              <label>
                URL base
                <input readOnly value={FELPLEX_GT_DEFAULT_BASE_URLS[environment]} />
              </label>
            </div>

            <div className="billing-inline-actions">
              <button type="submit" disabled={busy}>{busy ? "Guardando..." : "Guardar configuracion"}</button>
              <button type="button" className="settings-secondary-button" disabled={busy} onClick={handleTestConnection}>
                Probar conexion
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
