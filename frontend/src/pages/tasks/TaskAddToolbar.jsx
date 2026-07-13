import "./operationalTasks.css"

export default function TaskAddToolbar({
  onMembersClick,
  onStepListClick,
  onAttachmentClick,
  canOpenMembers = false,
  canManagePlan = false,
  canUploadAttachments = false
}) {
  return (
    <div className="ot-add-toolbar" aria-label="Añadir a la tarea">
      <span className="ot-add-toolbar__label">Añadir</span>
      <button
        type="button"
        className="ot-add-toolbar__btn"
        onClick={onStepListClick}
        disabled={!canManagePlan}
      >
        <span className="ot-add-toolbar__icon" aria-hidden="true">☰</span>
        Lista de pasos
      </button>
      <button
        type="button"
        className="ot-add-toolbar__btn"
        onClick={onAttachmentClick}
        disabled={!canUploadAttachments}
      >
        <span className="ot-add-toolbar__icon" aria-hidden="true">📎</span>
        Adjunto
      </button>
      <button
        type="button"
        className="ot-add-toolbar__btn"
        onClick={onMembersClick}
        disabled={!canOpenMembers}
      >
        <span className="ot-add-toolbar__icon" aria-hidden="true">◉</span>
        Miembros
      </button>
    </div>
  )
}
