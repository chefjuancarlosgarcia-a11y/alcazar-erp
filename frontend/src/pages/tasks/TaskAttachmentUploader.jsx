import { useRef, useState } from "react"
import {
  registerTaskAttachment,
  uploadTaskFile
} from "../../services/taskWorkPlanService"
import "./operationalTasks.css"

export default function TaskAttachmentUploader({
  open = false,
  taskId,
  stepId = null,
  onClose,
  onUploaded,
  onError
}) {
  const inputRef = useRef(null)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkName, setLinkName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [mode, setMode] = useState("file")

  if (!open) return null

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length || !taskId) return
    setUploading(true)
    try {
      for (const file of files) {
        const attachmentId = crypto.randomUUID()
        const upload = await uploadTaskFile(taskId, file, attachmentId)
        if (upload.error) throw new Error(upload.error)
        const result = await registerTaskAttachment(taskId, {
          stepId,
          storagePath: upload.storagePath,
          displayName: file.name,
          mimeType: file.type,
          sizeBytes: file.size
        })
        if (result.error) throw new Error(result.error)
        onUploaded?.(result.data)
      }
      onClose?.()
    } catch (error) {
      onError?.(error.message || "No se pudo subir el archivo.")
    } finally {
      setUploading(false)
    }
  }

  async function handleLinkSubmit(event) {
    event.preventDefault()
    if (!linkUrl.trim()) return
    setUploading(true)
    try {
      const result = await registerTaskAttachment(taskId, {
        stepId,
        externalUrl: linkUrl.trim(),
        displayName: linkName.trim() || linkUrl.trim()
      })
      if (result.error) throw new Error(result.error)
      onUploaded?.(result.data)
      setLinkUrl("")
      setLinkName("")
      onClose?.()
    } catch (error) {
      onError?.(error.message || "No se pudo guardar el enlace.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="ot-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ot-modal erp-card"
        role="dialog"
        aria-modal="true"
        aria-label="Adjuntar archivo"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Adjuntar</h3>
        <div className="ot-attachment-uploader__tabs">
          <button
            type="button"
            className={mode === "file" ? "is-active" : ""}
            onClick={() => setMode("file")}
          >
            Archivo
          </button>
          <button
            type="button"
            className={mode === "link" ? "is-active" : ""}
            onClick={() => setMode("link")}
          >
            Enlace
          </button>
        </div>
        {mode === "file" ? (
          <div className="ot-attachment-uploader__drop">
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              capture="environment"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <p className="ot-muted">Imágenes, PDF, Excel, Word. Máx. 20 MB.</p>
            <button
              type="button"
              className="ot-btn ot-btn--primary"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Subiendo..." : "Seleccionar archivo"}
            </button>
          </div>
        ) : (
          <form className="ot-attachment-uploader__link" onSubmit={handleLinkSubmit}>
            <label className="ot-field">
              <span>URL</span>
              <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} required />
            </label>
            <label className="ot-field">
              <span>Nombre</span>
              <input value={linkName} onChange={(event) => setLinkName(event.target.value)} />
            </label>
            <button type="submit" className="ot-btn ot-btn--primary" disabled={uploading}>
              {uploading ? "Guardando..." : "Guardar enlace"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
