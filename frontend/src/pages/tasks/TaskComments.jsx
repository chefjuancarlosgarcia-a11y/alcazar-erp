import { useMemo, useState } from "react"
import { formatDueAt } from "./taskCardUtils"
import "./operationalTasks.css"

function renderMentions(text, members = []) {
  let output = text
  members.forEach((member) => {
    if (!member.full_name) return
    const pattern = new RegExp(`@${member.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi")
    output = output.replace(pattern, `<mark class="ot-mention">@${member.full_name}</mark>`)
  })
  return output
}

export default function TaskComments({
  task,
  canComment = false,
  saving = false,
  onCreate,
  onDelete
}) {
  const [body, setBody] = useState("")
  const [mentionOpen, setMentionOpen] = useState(false)

  const comments = Array.isArray(task?.comments) ? task.comments : []
  const members = useMemo(() => {
    const assignees = task?.assignees || []
    const watchers = (task?.watchers || []).filter(
      (row) => !assignees.some((a) => a.profile_id === row.profile_id)
    )
    return [...assignees, ...watchers]
  }, [task])

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return members
    const query = body.split("@").pop()?.toLowerCase() || ""
    if (!query) return members
    return members.filter((row) => (row.full_name || "").toLowerCase().includes(query))
  }, [body, members, mentionOpen])

  function handleBodyChange(value) {
    setBody(value)
    setMentionOpen(value.includes("@") && !value.endsWith(" "))
  }

  function insertMention(name) {
    const atIndex = body.lastIndexOf("@")
    const prefix = atIndex >= 0 ? body.slice(0, atIndex) : body
    setBody(`${prefix}@${name} `)
    setMentionOpen(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const text = body.trim()
    if (!text) return
    await onCreate?.(text)
    setBody("")
    setMentionOpen(false)
  }

  return (
    <section className="ot-detail-block erp-card ot-comments">
      <header className="ot-detail-block__head">
        <span className="ot-detail-block__icon ot-detail-block__icon--comments" aria-hidden="true" />
        <div>
          <h3 className="ot-detail-block__title">Conversación</h3>
          <p className="ot-detail-block__hint">{comments.length} comentario{comments.length === 1 ? "" : "s"}</p>
        </div>
      </header>
      <div className="ot-detail-block__content">
        <ul className="ot-comments__list">
          {comments.map((comment) => (
            <li key={comment.id} className="ot-comments__item">
              <div className="ot-comments__head">
                <strong>{comment.created_by_name || "Usuario"}</strong>
                <time>{formatDueAt(comment.created_at)}</time>
              </div>
              <p
                className="ot-comments__body"
                dangerouslySetInnerHTML={{ __html: renderMentions(comment.body_markdown, members) }}
              />
              {canComment && comment.created_by === task?.current_user_id ? (
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost ot-btn--small"
                  disabled={saving}
                  onClick={() => onDelete?.(comment.id)}
                >
                  Eliminar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canComment ? (
          <form className="ot-comments__composer" onSubmit={handleSubmit}>
            <textarea
              value={body}
              onChange={(event) => handleBodyChange(event.target.value)}
              placeholder="Escribe un comentario... Usa @ para mencionar"
              rows={3}
              disabled={saving}
            />
            {mentionOpen && mentionCandidates.length > 0 ? (
              <ul className="ot-mention-list" role="listbox">
                {mentionCandidates.map((row) => (
                  <li key={row.profile_id}>
                    <button type="button" onClick={() => insertMention(row.full_name)}>
                      @{row.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="submit" className="ot-btn ot-btn--primary" disabled={saving || !body.trim()}>
              Comentar
            </button>
          </form>
        ) : null}
      </div>
    </section>
  )
}
