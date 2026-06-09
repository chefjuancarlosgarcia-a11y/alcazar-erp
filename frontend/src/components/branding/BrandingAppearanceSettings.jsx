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
  PRESET_THEMES
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

  const hasChanges = useMemo(() => brandingSnapshot(saved) !== brandingSnapshot(draft), [saved, draft])
  const paletteVariants = useMemo(() => generatePaletteVariants(draft.primaryColor), [draft.primaryColor])

  useEffect(() => {
    getBrandingSettings().then(({ data }) => {
      const normalized = normalizeBrandingDraft(data)
      setSaved(normalized)
      setDraft(normalized)
    })
  }, [])

  useEffect(() => {
    if (previewRef.current) applyBrandingTheme(draft, previewRef.current)
  }, [draft])

  function patchDraft(next) {
    setDraft((current) => normalizeBrandingDraft({ ...current, ...next, presetTheme: next.presetTheme || "custom" }))
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

  function applyPaletteVariant(variantKey) {
    const palette = paletteVariants[variantKey]
    if (!palette) return
    patchDraft({
      paletteVariant: variantKey,
      primaryColor: palette.primaryColor,
      secondaryColor: palette.secondaryColor,
      accentColor: palette.accentColor,
      backgroundColor: palette.backgroundColor,
      surfaceColor: palette.surfaceColor
    })
  }

  function applyQuickTheme(themeId) {
    const preset = applyPresetTheme(themeId)
    if (!preset) return
    patchDraft(preset)
    setMessage(`Tema ${PRESET_THEMES[themeId].label} aplicado en vista previa.`)
  }

  async function handleSave() {
    setBusy(true)
    setError("")
    const result = await saveBrandingSettings(draft)
    if (result.error) {
      setError("Cambios guardados localmente. Verifica la migracion app_settings / branding-assets en Supabase.")
    } else {
      setMessage("Cambios guardados correctamente.")
    }
    setSaved(normalizeBrandingDraft(result.data))
    setDraft(normalizeBrandingDraft(result.data))
    setBusy(false)
  }

  function handleRestore() {
    patchDraft(saved)
    setMessage("Se restauro la ultima version guardada.")
    setError("")
  }

  function handleRestoreDefaults() {
    patchDraft(DEFAULT_BRANDING_SETTINGS)
    setMessage("Valores predeterminados cargados en vista previa.")
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
                <label className="branding-upload-button">
                  Subir imagen
                  <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" disabled={busy} onChange={(event) => handleLogoUpload(event, "main")} />
                </label>
              </div>
              <div>
                <strong>Logo compacto</strong>
                <div className="branding-logo-preview compact">{draft.compactLogoUrl ? <img src={draft.compactLogoUrl} alt="" /> : <span>{draft.monogram}</span>}</div>
                <label className="branding-upload-button">
                  Subir imagen
                  <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" disabled={busy} onChange={(event) => handleLogoUpload(event, "compact")} />
                </label>
              </div>
            </div>
            <p className="branding-help">Formatos: PNG, JPG, SVG. Se guardan en Supabase Storage.</p>
          </article>

          <article className="settings-card">
            <h3>Color principal</h3>
            <label className="branding-color-picker">Elige un color base
              <input type="color" value={draft.primaryColor} onChange={(event) => patchDraft({ primaryColor: event.target.value, accentColor: event.target.value })} />
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
            <button type="button" disabled={busy} onClick={handleRestoreDefaults}>Restaurar predeterminado</button>
          </div>
        </section>

        <section className="branding-column branding-column-preview" ref={previewRef}>
          <div className="branding-preview-label">Vista previa en vivo</div>
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
                    onClick={() => patchDraft({ primaryColor: color, accentColor: color })}
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
