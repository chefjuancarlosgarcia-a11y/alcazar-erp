import { useRef, useState } from "react"
import { formatDueAt } from "./taskCardUtils"
import { submitTaskEvidence, uploadTaskFile } from "../../services/taskWorkPlanService"
import "./operationalTasks.css"

export default function TaskEvidencePanel({
  task,
  evidence = [],
  canSubmit = false,
  canVerify = false,
  saving = false,
  onSubmitted,
  onVerify,
  onDelete,
  onError
}) {
  const inputRef = useRef(null)
  const [noteText, setNoteText] = useState("")
  const [uploading, setUploading] = useState(false)

  if (!task?.evidence_required && evidence.length === 0) return null

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        const evidenceId = crypto.randomUUID()
        const upload = await uploadTaskFile(task.id, file, `evidence-${evidenceId}`)
        if (upload.error) throw new Error(upload.error)
        const result = await submitTaskEvidence(task.id, {
          evidenceType: (file.type || "").startsWith("image/") ? "photo" : "document",
          storagePath: upload.storagePath,
          displayName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          noteText: noteText.trim() || null
        })
        if (result.error) throw new Error(result.error)
        onSubmitted?.(result.data)
      }
      setNoteText("")
    } catch (error) {
      onError?.(error.message || "No se pudo enviar evidencia.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="ot-detail-block erp-card ot-evidence">
      <header className="ot-detail-block__head">
        <span className="ot-detail-block__icon ot-detail-block__icon--evidence" aria-hidden="true" />
        <div>
          <h3 className="ot-detail-block__title">Evidencia</h3>
          <p className="ot-detail-block__hint">
            {task.evidence_required
              ? "Prueba de que el trabajo fue realizado"
              : "Registro opcional de cierre"}
          </p>
        </div>
      </header>
      <div className="ot-detail-block__content">
        {evidence.length > 0 ? (
          <ul className="ot-evidence__list">
            {evidence.map((row) => (
              <li key={row.id} className="ot-evidence__item">
                <div>
                  <strong>{row.display_name}</strong>
                  <small>
                    {row.submitted_by_name} · {formatDueAt(row.submitted_at)}
                    {row.verified_at ? " · Verificada" : ""}
                  </small>
                  {row.note_text ? <p>{row.note_text}</p> : null}
                </div>
                <div className="ot-evidence__actions">
                  {canVerify && !row.verified_at ? (
                    <button
                      type="button"
                      className="ot-btn ot-btn--ghost ot-btn--small"
                      disabled={saving}
                      onClick={() => onVerify?.(row.id)}
                    >
                      Verificar
                    </button>
                  ) : null}
                  {canSubmit ? (
                    <button
                      type="button"
                      className="ot-btn ot-btn--ghost ot-btn--small"
                      disabled={saving}
                      onClick={() => onDelete?.(row.id)}
                    >
                      Eliminar
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ot-muted">Sin evidencia registrada.</p>
        )}
        {canSubmit ? (
          <div className="ot-evidence__upload">
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Nota opcional sobre la evidencia"
              rows={2}
            />
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.pdf,video/*"
              capture="environment"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <button
              type="button"
              className="ot-btn ot-btn--primary"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Enviando..." : "Enviar evidencia"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
