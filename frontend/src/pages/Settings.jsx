import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { canManageRoleCatalog, normalizeRole } from "../utils/profilePermissions"
import BrandingAppearanceSettings from "../components/branding/BrandingAppearanceSettings"
import {
  PRINT_JOB_TYPES,
  buildTestPrintPayload,
  createPrintJob,
  getPosPrinters,
  savePosPrinter,
  setPosPrinterActive
} from "../services/printingService"
import "./Settings.css"

const EMPTY_PRINTER = {
  id: "",
  name: "",
  windows_printer_name: "",
  location: "CAJA",
  printer_type: "windows_usb",
  ip_address: "",
  port: 9100,
  paper_width: "80mm",
  supported_job_types: ["test", "prebill"],
  is_active: true
}

function Settings() {
  const { user } = useAuth()
  const canManageRoles = canManageRoleCatalog(user)
  const canManagePrinters = ["admin", "gerente_general"].includes(normalizeRole(user?.role))
  const [activeTab, setActiveTab] = useState("branding")

  return (
    <section className="settings-page">
      <nav className="settings-tabs">
        <button className={`settings-tab ${activeTab === "branding" ? "active" : ""}`} onClick={() => setActiveTab("branding")}>
          Apariencia y Marca
        </button>
        {canManageRoles && (
          <Link className="settings-tab" to="/hr?section=catalogos&tab=roles">
            Roles y áreas (RRHH)
          </Link>
        )}
        <Link className="settings-tab" to="/settings/tickets">
          Diseno de Tickets
        </Link>
        {canManagePrinters && (
          <button className={`settings-tab ${activeTab === "printers" ? "active" : ""}`} onClick={() => setActiveTab("printers")}>
            Impresoras
          </button>
        )}
      </nav>

      <div className="settings-content settings-content-wide">
        {activeTab === "branding" && <BrandingAppearanceSettings />}
        {activeTab === "printers" && canManagePrinters && <PrinterSettings />}
      </div>
    </section>
  )
}

function PrinterSettings() {
  const [printers, setPrinters] = useState([])
  const [form, setForm] = useState(EMPTY_PRINTER)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const selectedPrinter = useMemo(() => printers.find((printer) => printer.id === form.id), [printers, form.id])

  useEffect(() => {
    loadPrinters()
  }, [])

  async function loadPrinters() {
    setLoading(true)
    const result = await getPosPrinters()
    setLoading(false)
    if (result.error) {
      setError(result.error.message || "No se pudieron cargar impresoras.")
      return
    }
    setPrinters(result.data)
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function toggleJobType(jobType) {
    setForm((current) => {
      const currentTypes = current.supported_job_types || []
      const nextTypes = currentTypes.includes(jobType)
        ? currentTypes.filter((type) => type !== jobType)
        : [...currentTypes, jobType]
      return { ...current, supported_job_types: nextTypes.length ? nextTypes : ["test", "prebill"] }
    })
  }

  function editPrinter(printer) {
    setForm({
      ...EMPTY_PRINTER,
      ...printer,
      supported_job_types: printer.supported_job_types?.length ? printer.supported_job_types : ["test", "prebill"],
      port: printer.port || 9100
    })
    setMessage("")
    setError("")
  }

  function resetForm() {
    setForm(EMPTY_PRINTER)
    setMessage("")
    setError("")
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    const result = await savePosPrinter(form)
    setSaving(false)
    if (result.error) {
      setError(result.error.message || "No se pudo guardar la impresora.")
      return
    }
    setMessage("Impresora guardada.")
    resetForm()
    loadPrinters()
  }

  async function toggleActive(printer) {
    const result = await setPosPrinterActive(printer.id, !printer.is_active)
    if (result.error) {
      setError(result.error.message || "No se pudo cambiar el estado.")
      return
    }
    setMessage(result.data.is_active ? "Impresora activada." : "Impresora desactivada.")
    loadPrinters()
  }

  async function testPrinter(printer) {
    setError("")
    setMessage("Creando trabajo de prueba...")
    const result = await createPrintJob({
      printerId: printer.id,
      jobType: "test",
      payload: buildTestPrintPayload(printer)
    })
    if (result.error) {
      setError(result.error.message || "No se pudo crear la prueba de impresion.")
      setMessage("")
      return
    }
    setMessage("Trabajo de prueba creado. El print-agent lo tomara en segundos.")
  }

  return (
    <div className="printer-settings">
      <form className="settings-card printer-form" onSubmit={submit}>
        <div>
          <p className="settings-eyebrow">Configuracion</p>
          <h2>{form.id ? "Editar impresora" : "Nueva impresora"}</h2>
          <p>Configura las impresoras instaladas en Windows para que el agente local pueda procesar trabajos.</p>
        </div>

        {message && <div className="settings-feedback">{message}</div>}
        {error && <div className="settings-feedback warning">{error}</div>}

        <div className="printer-form-grid">
          <label>Nombre visible<input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="CAJA" /></label>
          <label>Nombre en Windows<input required value={form.windows_printer_name} onChange={(event) => update("windows_printer_name", event.target.value)} placeholder="CAJA" /></label>
          <label>Ubicacion<input value={form.location || ""} onChange={(event) => update("location", event.target.value)} placeholder="CAJA" /></label>
          <label>Tipo<select value={form.printer_type} onChange={(event) => update("printer_type", event.target.value)}><option value="windows_usb">Windows USB</option><option value="windows_network">Windows red</option><option value="tcp_ip">TCP/IP</option></select></label>
          <label>IP TCP<input value={form.ip_address || ""} onChange={(event) => update("ip_address", event.target.value)} placeholder="192.168.x.x" /></label>
          <label>Puerto<input type="number" min="1" max="65535" value={form.port} onChange={(event) => update("port", event.target.value)} /></label>
          <label>Ancho papel<select value={form.paper_width} onChange={(event) => update("paper_width", event.target.value)}><option value="80mm">80mm</option><option value="58mm">58mm</option></select></label>
        </div>

        <div className="printer-job-types">
          <span>Tipos soportados</span>
          {PRINT_JOB_TYPES.map((type) => (
            <label key={type} className="printer-chip">
              <input type="checkbox" checked={(form.supported_job_types || []).includes(type)} onChange={() => toggleJobType(type)} />
              {type}
            </label>
          ))}
        </div>

        <label className="printer-inline-check">
          <input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} />
          Activa
        </label>

        <div className="printer-actions">
          <button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar impresora"}</button>
          {selectedPrinter && <button type="button" className="settings-secondary-button" onClick={() => testPrinter(selectedPrinter)}>Probar impresion</button>}
          {form.id && <button type="button" className="settings-secondary-button" onClick={resetForm}>Nueva</button>}
        </div>
      </form>

      <article className="settings-card printer-list">
        <div>
          <p className="settings-eyebrow">Impresoras</p>
          <h2>Registradas</h2>
          <p>{loading ? "Cargando..." : `${printers.length} impresora(s)`}</p>
        </div>
        <div className="printer-list-grid">
          {printers.map((printer) => (
            <div className="printer-row" key={printer.id}>
              <div>
                <strong>{printer.name}</strong>
                <span>{printer.windows_printer_name} · {printer.location || "Sin ubicacion"} · {printer.paper_width}</span>
                <small>{printer.printer_type}{printer.ip_address ? ` · ${printer.ip_address}:${printer.port}` : ""}</small>
              </div>
              <div className="printer-row-actions">
                <span className={printer.is_active ? "printer-status active" : "printer-status"}>{printer.is_active ? "Activa" : "Inactiva"}</span>
                <button type="button" onClick={() => editPrinter(printer)}>Editar</button>
                <button type="button" onClick={() => testPrinter(printer)} disabled={!printer.is_active}>Probar</button>
                <button type="button" onClick={() => toggleActive(printer)}>{printer.is_active ? "Desactivar" : "Activar"}</button>
              </div>
            </div>
          ))}
          {!printers.length && !loading && <p className="settings-empty">No hay impresoras configuradas.</p>}
        </div>
      </article>
    </div>
  )
}

export default Settings
