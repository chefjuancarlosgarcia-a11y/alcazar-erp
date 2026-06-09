import { useEffect, useMemo, useRef, useState } from "react"
import {
  DEFAULT_BRANDING_SETTINGS,
  getBrandingSettings,
  saveBrandingSettings,
  uploadBrandingLogo
} from "../../services/appSettingsService"
import {
  applyBrandingTheme,
  applyPresetTheme,
  extractColorsFromImageFile,
  generatePaletteVariants,
  normalizeBrandingDraft,
  PALETTE_VARIANT_LABELS,
  PRESET_THEMES,
  themeFromPaletteVariant
} from "../../utils/brandingTheme"
import ErpLivePreview from "./ErpLivePreview"
import "./BrandingAppearance.css"

function brandingSnapshot(value) {
  return JSON.stringify(normalizeBrandingDraft(value))
}

export default function BrandingAppearanceSettings() {
  const [saved, setSaved] = useState(DEFAULT_BRANDING_SETTINGS)
  const [draft, setDraft] = useState(DEFAULT_BRANDING_SETTINGS)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [logoExtract, setLogoExtract] = useState(null)
  const previewRef = useRef(null)
  const savedRef = useRef(saved)

  const hasChanges = useMemo(() => brandingSnapshot(saved) !== brandingSnapshot(draft), [saved, draft])
  const paletteVariants = useMemo(() => generatePaletteVariants(draft.primaryColor), [draft.primaryColor])
  const activePaletteLabel = PALETTE_VARIANT_LABELS[draft.paletteVariant] || draft.paletteVariant

  useEffect(() => {
    getBrandingSettings().then(({ data }) => {
      const normalized = normalizeBrandingDraft(data)
      setSaved(normalized)
      setDraft(normalized)
    })
  }, [])

  useEffect(() => {
    savedRef.current = saved
  }, [saved])

  useEffect(() => {
    if (previewRef.current) applyBrandingTheme(draft, previewRef.current)
  }, [draft])

  useEffect(() => {
    applyBrandingTheme(draft, document.documentElement)
  }, [draft])

  useEffect(() => {
    return () => applyBrandingTheme(savedRef.current, document.documentElement)
  }, [])

  function patchDraft(next) {
    setDraft((current) => normalizeBrandingDraft({ ...current, ...next, presetTheme: next.presetTheme ?? current.presetTheme ?? "custom" }))
  }

  async function handleLogoUpload(event, variant) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setBusy(true)
    setError("")
    const upload = await uploadBrandingLogo(file, variant)
    if (upload.error) {
      setError(upload.error.message || "No se pudo subir el logo.")
      setBusy(false)
      return
    }
    const field = variant === "compact" ? "compactLogoUrl" : "logoUrl"
    patchDraft({ [field]: upload.data })
    if (variant === "main") {
      try {
        const extracted = await extractColorsFromImageFile(file)
        setLogoExtract(extracted)
        patchDraft({
          primaryColor: extracted.dominant,
          secondaryColor: extracted.secondary,
          accentColor: extracted.accent
        })
        setMessage("Colores sugeridos desde tu logo.")
      } catch {
        setMessage("Logo cargado. No se pudieron extraer colores automaticamente.")
      }
    } else {
      setMessage("Logo compacto cargado.")
    }
    setBusy(false)
  }

  function removeLogo(variant) {
    if (variant === "compact") {
      patchDraft({ compactLogoUrl: "" })
      setMessage("Logo compacto removido.")
    } else {
      patchDraft({ logoUrl: "" })
      setLogoExtract(null)
      setMessage("Logo principal removido.")
    }
  }

  function applyPaletteVariant(variantKey) {
    const tokens = themeFromPaletteVariant(draft.primaryColor, variantKey, draft.themeMode)
    patchDraft({
      ...tokens,
      paletteVariant: variantKey,
      presetTheme: "custom"
    })
    setMessage(`Paleta ${PALETTE_VARIANT_LABELS[variantKey] || variantKey} aplicada en vista previa.`)
  }

  function applyQuickTheme(themeId) {
    const preset = applyPresetTheme(themeId)
    if (!preset) return
    patchDraft({ ...preset, presetTheme: themeId })
    setMessage(`${PRESET_THEMES[themeId].label} aplicado en vista previa.`)
  }

  async function handleSave() {
    setBusy(true)
    setError("")
    const payload = normalizeBrandingDraft({
      ...draft,
      logoUrl: draft.logoUrl || "",
      compactLogoUrl: draft.compactLogoUrl || ""
    })
    const result = await saveBrandingSettings(payload)
    if (result.error) {
      setError("Cambios guardados localmente. Verifica la migracion app_settings / branding-assets en Supabase.")
    } else {
      setMessage("Apariencia guardada correctamente.")
    }
    const normalized = normalizeBrandingDraft(result.data)
    setSaved(normalized)
    setDraft(normalized)
    setBusy(false)
  }

  function handleRestore() {
    patchDraft(saved)
    setMessage("Se descartaron los cambios no guardados.")
    setError("")
  }

  function handleRestoreColors() {
    patchDraft({
      ...DEFAULT_BRANDING_SETTINGS,
      commercialName: draft.commercialName,
      subtitle: draft.subtitle,
      monogram: draft.monogram,
      logoUrl: draft.logoUrl,
      compactLogoUrl: draft.compactLogoUrl
    })
    setMessage("Colores restaurados al predeterminado.")
  }

  function handleRemoveAllLogos() {
    patchDraft({ logoUrl: "", compactLogoUrl: "" })
    setLogoExtract(null)
    setMessage("Logos removidos. Guarda para persistir.")
  }

  return (
    <div className="branding-appearance">
      <header className="branding-appearance-header">
        <div>
          <p className="settings-eyebrow">Configuracion</p>
          <h2>Apariencia y Marca</h2>
          <p>Personaliza como se ve el ERP para tu restaurante sin tocar codigo.</p>
        </div>
        <div className="branding-appearance-status">
          {hasChanges && <span className="branding-unsaved">Tienes cambios sin guardar</span>}
          {message && <span className="branding-message">{message}</span>}
          {error && <span className="branding-error" role="alert">{error}</span>}
        </div>
      </header>

      <div className="branding-appearance-grid">
        <section className="branding-column branding-column-config">
          <article className="settings-card">
            <h3>Identidad</h3>
            <label>Nombre comercial
              <input value={draft.commercialName} onChange={(event) => patchDraft({ commercialName: event.target.value })} />
            </label>
            <label>Subtitulo
              <input value={draft.subtitle} onChange={(event) => patchDraft({ subtitle: event.target.value })} />
            </label>
            <label>Monograma (fallback)
              <input maxLength={3} value={draft.monogram} onChange={(event) => patchDraft({ monogram: event.target.value.toUpperCase() })} />
            </label>
          </article>

          <article className="settings-card">
            <h3>Logos</h3>
            <div className="branding-logo-upload">
              <div>
                <strong>Logo principal</strong>
                <div className="branding-logo-preview">{draft.logoUrl ? <img src={draft.logoUrl} alt="" /> : <span>{draft.monogram}</span>}</div>
                <div className="branding-logo-actions">
                  <label className="branding-upload-button">
                    Subir imagen
                    <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" disabled={busy} onChange={(event) => handleLogoUpload(event, "main")} />
                  </label>
                  <button type="button" className="danger" disabled={busy || !draft.logoUrl} onClick={() => removeLogo("main")}>Quitar logo</button>
                </div>
              </div>
              <div>
                <strong>Logo compacto</strong>
                <div className="branding-logo-preview compact">{draft.compactLogoUrl ? <img src={draft.compactLogoUrl} alt="" /> : <span>{draft.monogram}</span>}</div>
                <div className="branding-logo-actions">
                  <label className="branding-upload-button">
                    Subir imagen
                    <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" disabled={busy} onChange={(event) => handleLogoUpload(event, "compact")} />
                  </label>
                  <button type="button" className="danger" disabled={busy || !draft.compactLogoUrl} onClick={() => removeLogo("compact")}>Quitar logo</button>
                </div>
              </div>
            </div>
            <p className="branding-help">Formatos: PNG, JPG, SVG. Se guardan en Supabase Storage.</p>
          </article>

          <article className="settings-card">
            <h3>Color principal</h3>
            <label className="branding-color-picker">Elige un color base
              <input type="color" value={draft.primaryColor} onChange={(event) => patchDraft({ primaryColor: event.target.value, accentColor: event.target.value, presetTheme: "custom" })} />
              <code>{draft.primaryColor}</code>
            </label>
          </article>

          <article className="settings-card">
            <h3>Personalizacion avanzada</h3>
            <fieldset className="branding-radio-group">
              <legend>Modo</legend>
              <label><input type="radio" name="themeMode" checked={draft.themeMode === "light"} onChange={() => patchDraft({ themeMode: "light" })} /> Claro</label>
              <label><input type="radio" name="themeMode" checked={draft.themeMode === "dark"} onChange={() => patchDraft({ themeMode: "dark" })} /> Oscuro</label>
            </fieldset>
            <fieldset className="branding-radio-group">
              <legend>Densidad</legend>
              <label><input type="radio" name="density" checked={draft.density === "compact"} onChange={() => patchDraft({ density: "compact" })} /> Compacta</label>
              <label><input type="radio" name="density" checked={draft.density === "normal"} onChange={() => patchDraft({ density: "normal" })} /> Normal</label>
              <label><input type="radio" name="density" checked={draft.density === "comfortable"} onChange={() => patchDraft({ density: "comfortable" })} /> Grande</label>
            </fieldset>
            <fieldset className="branding-radio-group">
              <legend>Bordes</legend>
              <label><input type="radio" name="borderStyle" checked={draft.borderStyle === "square"} onChange={() => patchDraft({ borderStyle: "square" })} /> Cuadrado</label>
              <label><input type="radio" name="borderStyle" checked={draft.borderStyle === "soft"} onChange={() => patchDraft({ borderStyle: "soft" })} /> Suave</label>
              <label><input type="radio" name="borderStyle" checked={draft.borderStyle === "modern"} onChange={() => patchDraft({ borderStyle: "modern" })} /> Moderno</label>
            </fieldset>
          </article>

          <div className="branding-actions">
            <button type="button" className="primary" disabled={busy || !hasChanges} onClick={handleSave}>Guardar cambios</button>
            <button type="button" disabled={busy || !hasChanges} onClick={handleRestore}>Descartar cambios</button>
            <button type="button" disabled={busy} onClick={handleRestoreColors}>Restaurar colores</button>
            <button type="button" disabled={busy || (!draft.logoUrl && !draft.compactLogoUrl)} onClick={handleRemoveAllLogos}>Quitar logos</button>
          </div>
        </section>

        <section className="branding-column branding-column-preview" ref={previewRef}>
          <div className="branding-preview-label">
            Vista previa en vivo
            <span className="branding-palette-active-badge">Paleta activa: {activePaletteLabel}</span>
          </div>
          <ErpLivePreview branding={draft} />
        </section>

        <section className="branding-column branding-column-themes">
          <article className="settings-card">
            <h3>Temas rapidos</h3>
            <div className="branding-theme-grid">
              {Object.values(PRESET_THEMES).map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`branding-theme-card ${draft.presetTheme === theme.id ? "active" : ""}`}
                  onClick={() => applyQuickTheme(theme.id)}
                >
                  <span className="swatch" style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})` }} />
                  <strong>{theme.label}</strong>
                </button>
              ))}
            </div>
          </article>

          <article className="settings-card">
            <h3>Paletas sugeridas</h3>
            <p className="branding-help">Generadas desde tu color principal.</p>
            <div className="branding-palette-grid">
              {Object.values(paletteVariants).map((palette) => (
                <div key={palette.id} className={`branding-palette-card ${draft.paletteVariant === palette.id ? "active" : ""}`}>
                  <strong>{palette.label}</strong>
                  <div className="branding-palette-swatches">
                    <span style={{ background: palette.primaryColor }} title="Primario" />
                    <span style={{ background: palette.secondaryColor }} title="Secundario" />
                    <span style={{ background: palette.accentColor }} title="Acento" />
                  </div>
                  <button type="button" className="primary" onClick={() => applyPaletteVariant(palette.id)}>Aplicar</button>
                </div>
              ))}
            </div>
          </article>

          {logoExtract && (
            <article className="settings-card">
              <h3>Colores del logo</h3>
              <p className="branding-help">Detectados automaticamente al subir tu logo.</p>
              <div className="branding-logo-colors">
                {[["Dominante", logoExtract.dominant], ["Secundario", logoExtract.secondary], ["Acento", logoExtract.accent]].map(([label, color]) => (
                  <button
                    key={label}
                    type="button"
                    className="branding-logo-color"
                    onClick={() => patchDraft({ primaryColor: color, accentColor: color, presetTheme: "custom" })}
                  >
                    <span style={{ background: color }} />
                    <div><strong>{label}</strong><code>{color}</code></div>
                  </button>
                ))}
              </div>
            </article>
          )}
        </section>
      </div>
    </div>
  )
}
