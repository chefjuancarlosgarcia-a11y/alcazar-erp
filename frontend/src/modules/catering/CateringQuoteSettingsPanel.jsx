import { useEffect, useState } from "react"
import {
  getCateringQuoteSettings,
  saveCateringQuoteSettings,
  uploadCateringQuoteLogo
} from "./cateringQuoteSettings"

export default function CateringQuoteSettingsPanel({ open, onClose, onSaved }) {
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!open) return
    setError("")
    setMessage("")
    loadSettings()
  }, [open])

  async function loadSettings() {
    setLoading(true)
    const result = await getCateringQuoteSettings()
    setLoading(false)
    if (result.error) setError(result.error)
    else setForm(result.data || {})
  }

  async function handleLogoChange(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    setError("")
    const result = await uploadCateringQuoteLogo(file)
    setUploadingLogo(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setForm((current) => ({ ...current, logoUrl: result.data }))
    setMessage("Logo cargado. Guarda para aplicar en cotizaciones.")
    event.target.value = ""
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    const result = await saveCateringQuoteSettings(form)
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setForm(result.data)
      setMessage("Configuracion guardada.")
      onSaved?.(result.data)
    }
  }

  if (!open) return null

  return (
    <div className="catering-quote-backdrop catering-quote-backdrop--nested" onClick={onClose}>
      <section className="catering-quote-modal" onClick={(e) => e.stopPropagation()}>
        <header className="catering-quote-modal__header">
          <div>
            <p>PDF / Empresa</p>
            <h2>Datos comerciales de cotizacion</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </header>

        {loading ? (
          <p className="catering-empty">Cargando configuracion...</p>
        ) : (
          <form className="catering-quote-modal__body" onSubmit={handleSubmit}>
            <section className="catering-quote-settings-header">
              <div className="catering-quote-settings-logo">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo de empresa" />
                ) : (
                  <div className="catering-quote-settings-logo__placeholder">GA</div>
                )}
              </div>
              <div className="catering-quote-settings-header__fields">
                <label>
                  Logotipo de empresa
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" onChange={handleLogoChange} disabled={uploadingLogo} />
                </label>
                <div className="catering-actions">
                  {form.logoUrl ? (
                    <button type="button" className="ghost" onClick={() => setForm((c) => ({ ...c, logoUrl: "" }))}>
                      Quitar logo
                    </button>
                  ) : null}
                  {uploadingLogo ? <small>Cargando logo...</small> : null}
                </div>
                <label>
                  Nombre comercial
                  <input value={form.commercialName || ""} onChange={(e) => setForm((c) => ({ ...c, commercialName: e.target.value }))} />
                </label>
                <label>
                  Texto de encabezado
                  <input value={form.headerText || ""} onChange={(e) => setForm((c) => ({ ...c, headerText: e.target.value }))} />
                </label>
                <label>
                  NIT
                  <input value={form.nit || ""} onChange={(e) => setForm((c) => ({ ...c, nit: e.target.value }))} />
                </label>
              </div>
            </section>

            <section className="catering-quote-settings-footer-fields">
              <h3>Datos del pie de pagina</h3>
              <p className="catering-quote-meta">Estos datos aparecen al final del PDF y de la vista previa.</p>
              <label>Direccion<input value={form.address || ""} onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))} /></label>
              <label>Teléfono<input value={form.phone || ""} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} /></label>
              <label>WhatsApp<input value={form.whatsapp || ""} onChange={(e) => setForm((c) => ({ ...c, whatsapp: e.target.value }))} /></label>
              <label>Correo<input type="email" value={form.email || ""} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} /></label>
              <label>Sitio web<input value={form.website || ""} onChange={(e) => setForm((c) => ({ ...c, website: e.target.value }))} /></label>
            </section>

            <label>
              Términos predeterminados
              <textarea rows={6} value={form.defaultTerms || ""} onChange={(e) => setForm((c) => ({ ...c, defaultTerms: e.target.value }))} />
            </label>

            {message ? <p className="catering-message success">{message}</p> : null}
            {error ? <p className="catering-message error">{error}</p> : null}

            <footer className="catering-quote-modal__footer">
              <button type="submit" className="primary" disabled={saving || uploadingLogo}>
                {saving ? "Guardando..." : "Guardar configuracion"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
