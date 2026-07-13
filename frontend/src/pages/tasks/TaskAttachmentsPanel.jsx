import { useEffect, useState } from "react"
import { getTaskFileSignedUrl } from "../../services/taskWorkPlanService"
import { formatDueAt } from "./taskCardUtils"
import "./operationalTasks.css"

function AttachmentPreview({ attachment }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let active = true
    if (attachment.attachment_type === "external_link") {
      setUrl(attachment.external_url)
      return undefined
    }
    if (!attachment.storage_path) return undefined
    getTaskFileSignedUrl(attachment.storage_path).then((result) => {
      if (active) setUrl(result.url)
    })
    return () => { active = false }
  }, [attachment])

  const isImage = (attachment.mime_type || "").startsWith("image/")

  if (attachment.attachment_type === "external_link") {
    return (
      <a href={attachment.external_url} target="_blank" rel="noreferrer" className="ot-attachment-card">
        <span className="ot-attachment-card__icon">🔗</span>
        <span>{attachment.display_name}</span>
      </a>
    )
  }

  return (
    <article className="ot-attachment-card">
      {isImage && url ? (
        <img src={url} alt={attachment.display_name} className="ot-attachment-card__preview" />
      ) : (
        <span className="ot-attachment-card__icon">📄</span>
      )}
      <div className="ot-attachment-card__meta">
        <strong>{attachment.display_name}</strong>
        <small>{formatDueAt(attachment.uploaded_at)}</small>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="ot-btn ot-btn--ghost ot-btn--small">
          Abrir
        </a>
      ) : null}
    </article>
  )
}

export default function TaskAttachmentsPanel({
  attachments = [],
  canEdit = false,
  saving = false,
  onDelete
}) {
  if (!attachments.length) {
    return <p className="ot-muted">Sin adjuntos todavía.</p>
  }

  return (
    <div className="ot-attachments-grid">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="ot-attachment-wrap">
          <AttachmentPreview attachment={attachment} />
          {canEdit ? (
            <button
              type="button"
              className="ot-btn ot-btn--ghost ot-btn--small"
              disabled={saving}
              onClick={() => onDelete?.(attachment.id)}
            >
              Eliminar
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
