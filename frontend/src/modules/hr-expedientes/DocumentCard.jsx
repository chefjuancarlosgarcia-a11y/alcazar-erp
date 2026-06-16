import { useEffect, useMemo, useRef, useState } from "react"
import {
  getSignedDocumentUrl,
  removeEmployeeFileCurrent,
  updateEmployeeFileCurrent,
  uploadEmployeeDocument
} from "./expedientesService"
import DocumentStatusBadge from "./DocumentStatusBadge"
import {
  formatDate,
  getDocumentDisplayStatus
} from "./expedientesUtils"

function buildFormState(entry, type) {
  const current = entry?.current_version
  return {
    issuedAt: current?.issued_at ? String(current.issued_at).slice(0, 10) : "",
    expiresAt: current?.expires_at ? String(current.expires_at).slice(0, 10) : "",
    noExpires: Boolean(current?.no_expires),
    signatureStatus: entry?.file?.signature_status || "pending",
    notes: current?.notes || ""
  }
}

export default function DocumentCard({
  profileId,
  type,
  entry,
  canWrite,
  canDelete,
  requiresFoodHandling = false,
  onUploaded
}) {
  const fileInputRef = useRef(null)
  const [mode, setMode] = useState("view")
  const [pendingFile, setPendingFile] = useState(null)
  const [form, setForm] = useState(() => buildFormState(entry, type))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [previewUrl, setPreviewUrl] = useState("")

  const current = entry?.current_version
  const displayStatus = useMemo(
    () => getDocumentDisplayStatus({ type, entry, requiresFoodHandling }),
    [type, entry, requiresFoodHandling]
  )
  const isImage = String(current?.mime_type || "").startsWith("image/")
  const hasFile = Boolean(current?.storage_path)

  useEffect(() => {
    setForm(buildFormState(entry, type))
    setMode("view")
    setPendingFile(null)
    setError("")
  }, [entry, type?.code])

  useEffect(() => {
    let active = true
    async function loadPreview() {
      if (!current?.storage_path || !isImage) {
        setPreviewUrl("")
        return
      }
      const result = await getSignedDocumentUrl(current.storage_path)
      if (active && !result.error) setPreviewUrl(result.data)
    }
    loadPreview()
    return () => { active = false }
  }, [current?.storage_path, isImage])

  function openEdit(replace = false) {
    setForm(buildFormState(entry, type))
    setPendingFile(null)
    setError("")
    setMode(replace ? "replace" : "edit")
  }

  function cancelEdit() {
    setForm(buildFormState(entry, type))
    setPendingFile(null)
    setError("")
    setMode("view")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handlePickFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    setError("")
  }

  async function handleOpenDocument() {
    if (!current?.storage_path) return
    const result = await getSignedDocumentUrl(current.storage_path)
    if (result.error) {
      setError(result.error)
      return
    }
    window.open(result.data, "_blank", "noopener,noreferrer")
  }

  async function handleDelete() {
    if (!canDelete || !hasFile) return
    const confirmed = window.confirm("¿Seguro que deseas eliminar este documento del expediente?")
    if (!confirmed) return
    setSaving(true)
    setError("")
    const result = await removeEmployeeFileCurrent(profileId, type.code)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onUploaded?.()
  }

  async function handleSave(event) {
    event?.preventDefault?.()
    if (!canWrite) return

    if (mode === "replace" && !pendingFile) {
      setError(hasFile ? "Selecciona un archivo para reemplazar." : "Selecciona un archivo para cargar.")
      return
    }

    if (mode === "edit" && !hasFile) {
      setError("Primero debes cargar un archivo.")
      return
    }

    setSaving(true)
    setError("")

    const expiresAt = form.noExpires ? null : (form.expiresAt || null)
    const issuedAt = form.issuedAt || null

    let result
    if (pendingFile) {
      result = await uploadEmployeeDocument({
        profileId,
        fileTypeCode: type.code,
        storageFolder: type.storage_folder,
        file: pendingFile,
        issuedAt,
        expiresAt,
        noExpires: form.noExpires,
        signatureStatus: type.requires_signature ? form.signatureStatus : null,
        notes: form.notes || null
      })
    } else {
      result = await updateEmployeeFileCurrent({
        profileId,
        fileTypeCode: type.code,
        issuedAt,
        expiresAt,
        noExpires: form.noExpires,
        signatureStatus: type.requires_signature ? form.signatureStatus : null,
        notes: form.notes || null
      })
    }

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }

    if (fileInputRef.current) fileInputRef.current.value = ""
    setPendingFile(null)
    setMode("view")
    onUploaded?.()
  }

  return (
    <article className={`expediente-doc-card ${mode !== "view" ? "expediente-doc-card--editing" : ""}`}>
      <header className="expediente-doc-card__head">
        <div>
          <h4>{type.label}</h4>
          {type.is_conditional ? <small>Obligatorio segun area</small> : null}
          {type.is_required ? <small>Documento obligatorio</small> : null}
        </div>
        <DocumentStatusBadge status={displayStatus} />
      </header>

      {previewUrl && mode === "view" ? (
        <img src={previewUrl} alt={type.label} className="expediente-doc-card__preview" />
      ) : null}

      {mode === "view" ? (
        <>
          <div className="expediente-doc-card__file">
            <span className="expediente-doc-card__file-label">Archivo actual</span>
            <strong>{current?.file_name || "Ningun archivo cargado"}</strong>
            <small>Cargado: {formatDate(current?.created_at)}</small>
          </div>

          <dl className="expediente-doc-card__meta">
            {current?.issued_at ? (
              <div><dt>Emision</dt><dd>{formatDate(current.issued_at)}</dd></div>
            ) : null}
            {current?.no_expires ? (
              <div><dt>Vencimiento</dt><dd>Sin vencimiento</dd></div>
            ) : current?.expires_at ? (
              <div><dt>Vencimiento</dt><dd>{formatDate(current.expires_at)}</dd></div>
            ) : null}
            {type.requires_signature ? (
              <div><dt>Firma</dt><dd>{entry?.file?.signature_status === "signed" ? "Firmado" : "Pendiente"}</dd></div>
            ) : null}
            {current?.notes ? (
              <div className="expediente-doc-card__notes"><dt>Observaciones</dt><dd>{current.notes}</dd></div>
            ) : null}
            {entry?.versions?.length > 1 ? (
              <div><dt>Historial</dt><dd>{entry.versions.length} versiones</dd></div>
            ) : null}
          </dl>

          {entry?.versions?.length > 1 ? (
            <details className="expediente-version-history">
              <summary>Ver historial de versiones</summary>
              <ul>
                {[...(entry.versions || [])]
                  .sort((a, b) => (b.version_number || 0) - (a.version_number || 0))
                  .map((version) => (
                    <li key={version.id}>
                      v{version.version_number} · {version.file_name}
                      {version.is_current ? " · actual" : ""}
                      · {formatDate(version.created_at)}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}

          <div className="expediente-doc-card__actions">
            {hasFile ? (
              <button type="button" className="expediente-btn expediente-btn--secondary" onClick={handleOpenDocument}>
                Ver
              </button>
            ) : null}
            {canWrite ? (
              <>
                {hasFile ? (
                  <button type="button" className="expediente-btn expediente-btn--primary" onClick={() => openEdit(false)}>
                    Editar datos
                  </button>
                ) : null}
                <button type="button" className="expediente-btn expediente-btn--secondary" onClick={() => openEdit(true)}>
                  {hasFile ? "Reemplazar archivo" : "Subir archivo"}
                </button>
              </>
            ) : null}
            {canDelete && hasFile ? (
              <button type="button" className="expediente-btn expediente-btn--danger" disabled={saving} onClick={handleDelete}>
                Eliminar archivo
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <form className="expediente-doc-card__edit" onSubmit={handleSave}>
          <p className="expediente-doc-card__edit-hint">
            {mode === "replace"
              ? "Selecciona un archivo nuevo. Se conservara el historial de versiones anteriores."
              : "Actualiza fechas, vencimiento, firma u observaciones del documento."}
          </p>

          <div className="expediente-file-picker">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="expediente-file-picker__input"
              onChange={handlePickFile}
            />
            <button
              type="button"
              className="expediente-btn expediente-btn--secondary expediente-file-picker__button"
              onClick={() => fileInputRef.current?.click()}
            >
              {pendingFile ? "Cambiar archivo seleccionado" : hasFile ? "Elegir archivo de reemplazo" : "Elegir archivo"}
            </button>
            <span className="expediente-file-picker__name">
              {pendingFile?.name || current?.file_name || "Ningun archivo seleccionado"}
            </span>
          </div>

          <div className="expediente-form-grid">
            <label>
              Fecha de emision
              <input
                type="date"
                value={form.issuedAt}
                onChange={(e) => setForm((c) => ({ ...c, issuedAt: e.target.value }))}
              />
            </label>
            <label>
              Fecha de vencimiento
              <input
                type="date"
                value={form.expiresAt}
                disabled={form.noExpires}
                onChange={(e) => setForm((c) => ({ ...c, expiresAt: e.target.value }))}
              />
            </label>
          </div>

          <label className="expediente-checkbox expediente-checkbox--inline">
            <input
              type="checkbox"
              checked={form.noExpires}
              onChange={(e) => setForm((c) => ({
                ...c,
                noExpires: e.target.checked,
                expiresAt: e.target.checked ? "" : c.expiresAt
              }))}
            />
            Este documento no vence
          </label>

          {type.requires_signature ? (
            <label>
              Estado de firma
              <select
                value={form.signatureStatus}
                onChange={(e) => setForm((c) => ({ ...c, signatureStatus: e.target.value }))}
              >
                <option value="pending">Pendiente</option>
                <option value="signed">Firmado</option>
              </select>
            </label>
          ) : null}

          <label>
            Observaciones
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
              placeholder="Notas internas sobre este documento"
            />
          </label>

          <div className="expediente-doc-card__actions">
            <button type="submit" className="expediente-btn expediente-btn--primary" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button type="button" className="expediente-btn expediente-btn--ghost" disabled={saving} onClick={cancelEdit}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error ? <p className="expediente-message error">{error}</p> : null}
    </article>
  )
}
