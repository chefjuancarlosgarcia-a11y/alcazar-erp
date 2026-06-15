import { useEffect, useState } from "react"
import { createManualCateringLead } from "./cateringService"
import { LEAD_SOURCE_OPTIONS, parseProductsInput } from "./cateringUtils"

const EMPTY_FORM = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  eventDate: "",
  eventTime: "",
  eventLocation: "",
  eventType: "",
  guestCount: "",
  leadSource: "whatsapp",
  productsRequested: "",
  notes: "",
  assignedTo: "",
  estimatedValue: "",
  followUpDate: ""
}

export default function CateringManualLeadModal({
  open,
  mode = "lead",
  profiles = [],
  onClose,
  onSaved
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [savedRequest, setSavedRequest] = useState(null)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setError("")
    setSavedRequest(null)
    setSaving(false)
  }, [open])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function validate() {
    if (!String(form.customerName || "").trim()) {
      return "El nombre del cliente es obligatorio."
    }
    if (!String(form.customerPhone || "").trim() && !String(form.customerEmail || "").trim()) {
      return "Indica telefono o correo del cliente."
    }
    if (form.guestCount !== "" && Number(form.guestCount) <= 0) {
      return "El numero de invitados debe ser mayor a 0."
    }
    return ""
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError("")
    const result = await createManualCateringLead({
      ...form,
      productsRequested: parseProductsInput(form.productsRequested)
    })
    setSaving(false)

    if (result.error) {
      setError(result.error)
      return
    }

    if (mode === "quickQuote") {
      onSaved?.({ request: result.data, action: "quote" })
      return
    }

    setSavedRequest(result.data)
  }

  function handleViewLead() {
    onSaved?.({ request: savedRequest, action: "view" })
  }

  function handleCreateQuote() {
    onSaved?.({ request: savedRequest, action: "quote" })
  }

  if (!open) return null

  return (
    <div className="catering-quote-backdrop" onClick={onClose}>
      <section className="catering-quote-modal catering-manual-lead-modal" onClick={(event) => event.stopPropagation()}>
        <header className="catering-quote-modal__header">
          <div>
            <p>Catering CRM</p>
            <h2>{mode === "quickQuote" ? "Cotizacion rapida" : "Nuevo lead de catering"}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </header>

        {savedRequest ? (
          <div className="catering-quote-modal__body catering-manual-lead-success">
            <p className="catering-message success">
              Lead creado: <strong>{savedRequest.customer_name}</strong>
            </p>
            <p>Deseas crear una cotizacion ahora?</p>
            <div className="catering-actions">
              <button type="button" className="ghost" onClick={handleViewLead}>Ver lead</button>
              <button type="button" className="primary" onClick={handleCreateQuote}>Crear cotizacion</button>
            </div>
          </div>
        ) : (
          <form className="catering-quote-modal__body" onSubmit={handleSubmit}>
            <fieldset className="catering-manual-lead-section">
              <legend>Datos cliente</legend>
              <div className="catering-form-grid catering-form-grid--two">
                <label>
                  Nombre *
                  <input
                    type="text"
                    value={form.customerName}
                    onChange={(event) => updateField("customerName", event.target.value)}
                    required
                  />
                </label>
                <label>
                  Telefono
                  <input
                    type="tel"
                    value={form.customerPhone}
                    onChange={(event) => updateField("customerPhone", event.target.value)}
                  />
                </label>
                <label>
                  Correo
                  <input
                    type="email"
                    value={form.customerEmail}
                    onChange={(event) => updateField("customerEmail", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="catering-manual-lead-section">
              <legend>Datos evento</legend>
              <div className="catering-form-grid catering-form-grid--two">
                <label>
                  Fecha del evento
                  <input
                    type="date"
                    value={form.eventDate}
                    onChange={(event) => updateField("eventDate", event.target.value)}
                  />
                </label>
                <label>
                  Hora del evento
                  <input
                    type="time"
                    value={form.eventTime}
                    onChange={(event) => updateField("eventTime", event.target.value)}
                  />
                </label>
                <label>
                  Lugar
                  <input
                    type="text"
                    value={form.eventLocation}
                    onChange={(event) => updateField("eventLocation", event.target.value)}
                  />
                </label>
                <label>
                  Tipo de evento
                  <input
                    type="text"
                    value={form.eventType}
                    onChange={(event) => updateField("eventType", event.target.value)}
                  />
                </label>
                <label>
                  Numero de invitados
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.guestCount}
                    onChange={(event) => updateField("guestCount", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="catering-manual-lead-section">
              <legend>Origen</legend>
              <label>
                Canal de origen
                <select
                  value={form.leadSource}
                  onChange={(event) => updateField("leadSource", event.target.value)}
                >
                  {LEAD_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="catering-manual-lead-section">
              <legend>Solicitud</legend>
              <div className="catering-form-grid">
                <label>
                  Productos / servicios solicitados
                  <textarea
                    rows={3}
                    value={form.productsRequested}
                    onChange={(event) => updateField("productsRequested", event.target.value)}
                    placeholder="Separados por coma o una linea por producto"
                  />
                </label>
                <label>
                  Notas
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => updateField("notes", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="catering-manual-lead-section">
              <legend>Comercial</legend>
              <div className="catering-form-grid catering-form-grid--two">
                <label>
                  Responsable
                  <select
                    value={form.assignedTo}
                    onChange={(event) => updateField("assignedTo", event.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.full_name || profile.username || profile.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valor estimado (Q)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.estimatedValue}
                    onChange={(event) => updateField("estimatedValue", event.target.value)}
                  />
                </label>
                <label>
                  Proximo seguimiento
                  <input
                    type="date"
                    value={form.followUpDate}
                    onChange={(event) => updateField("followUpDate", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            {error ? <p className="catering-message error">{error}</p> : null}

            <footer className="catering-quote-modal__footer">
              <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? "Guardando..." : mode === "quickQuote" ? "Guardar y cotizar" : "Guardar lead"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
