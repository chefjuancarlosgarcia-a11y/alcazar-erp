import { useMemo, useState } from "react"
import TaskStepRow from "./TaskStepRow"
import CreateStepListModal from "./CreateStepListModal"
import "./operationalTasks.css"

export default function TaskWorkPlan({
  task,
  canEdit = false,
  saving = false,
  onCreateList,
  onDeleteList,
  onCreateStep,
  onToggleStep,
  onUpdateStep,
  onDeleteStep,
  onConvertStep
}) {
  const [newStepText, setNewStepText] = useState({})
  const [createListOpen, setCreateListOpen] = useState(false)

  const lists = Array.isArray(task?.work_plan) ? task.work_plan : []
  const members = useMemo(() => {
    const assignees = task?.assignees || []
    const watchers = (task?.watchers || []).filter(
      (row) => !assignees.some((a) => a.profile_id === row.profile_id)
    )
    return [...assignees, ...watchers]
  }, [task])

  const allSteps = useMemo(
    () => lists.flatMap((list) => (list.steps || []).map((step) => ({ ...step, list_id: list.id }))),
    [lists]
  )

  const progress = task?.steps_progress

  return (
    <section className="ot-detail-block erp-card erp-card--form ot-work-plan">
      <header className="ot-detail-block__head">
        <span className="ot-detail-block__icon ot-detail-block__icon--steps" aria-hidden="true" />
        <div>
          <h3 className="ot-detail-block__title">Plan de trabajo</h3>
          <p className="ot-detail-block__hint">
            {progress
              ? `${progress.done || 0} de ${progress.total || 0} pasos completados`
              : "Organiza el trabajo en listas y pasos"}
          </p>
        </div>
        {canEdit ? (
          <button type="button" className="ot-btn ot-btn--ghost" onClick={() => setCreateListOpen(true)}>
            + Nueva lista
          </button>
        ) : null}
      </header>

      <div className="ot-detail-block__content ot-work-plan__body">
        {lists.length === 0 ? (
          <p className="ot-muted">Sin plan de trabajo. Añade una lista para comenzar.</p>
        ) : null}

        {lists.map((list) => {
          const steps = list.steps || []
          const done = steps.filter((row) => row.completed).length
          const total = steps.length
          const draft = newStepText[list.id] || ""

          return (
            <article key={list.id} className="ot-work-plan__list">
              <header className="ot-work-plan__list-head">
                <div>
                  <h4>{list.title}</h4>
                  <span className="ot-work-plan__progress">{done}/{total}</span>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className="ot-btn ot-btn--ghost ot-btn--small"
                    disabled={saving}
                    onClick={() => onDeleteList?.(list.id)}
                  >
                    Eliminar lista
                  </button>
                ) : null}
              </header>
              {total > 0 ? (
                <div className="ot-work-plan__bar" aria-hidden="true">
                  <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
              ) : null}
              <ul className="ot-work-plan__steps">
                {steps.map((step) => (
                  <TaskStepRow
                    key={step.id}
                    step={step}
                    listId={list.id}
                    members={members}
                    allSteps={allSteps}
                    canEdit={canEdit}
                    saving={saving}
                    onToggle={onToggleStep}
                    onUpdate={onUpdateStep}
                    onDelete={onDeleteStep}
                    onConvert={onConvertStep}
                  />
                ))}
              </ul>
              {canEdit ? (
                <form
                  className="ot-work-plan__add-step"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    const text = draft.trim()
                    if (!text) return
                    await onCreateStep?.(list.id, text)
                    setNewStepText((current) => ({ ...current, [list.id]: "" }))
                  }}
                >
                  <input
                    value={draft}
                    onChange={(event) => setNewStepText((current) => ({
                      ...current,
                      [list.id]: event.target.value
                    }))}
                    placeholder="Añadir paso..."
                    disabled={saving}
                  />
                  <button type="submit" className="ot-btn ot-btn--ghost" disabled={saving || !draft.trim()}>
                    Añadir
                  </button>
                </form>
              ) : null}
            </article>
          )
        })}
      </div>

      <CreateStepListModal
        open={createListOpen}
        lists={lists}
        saving={saving}
        onClose={() => setCreateListOpen(false)}
        onConfirm={async (payload) => {
          await onCreateList?.(payload)
          setCreateListOpen(false)
        }}
      />
    </section>
  )
}
