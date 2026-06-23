import {
  getProcessRunProgress,
  getStepDisplayStatus,
  isProcessStepUnlocked
} from "../../utils/operationalProcessProgress"

function StepStatusIcon({ status }) {
  if (status === "completed") return <span className="operational-process-step__icon is-done">✓</span>
  if (status === "pending_review") return <span className="operational-process-step__icon is-review">◷</span>
  if (status === "in_progress") return <span className="operational-process-step__icon is-active">●</span>
  if (status === "cancelled") return <span className="operational-process-step__icon is-cancelled">✕</span>
  if (status === "overdue" || status === "late") return <span className="operational-process-step__icon is-late">!</span>
  return <span className="operational-process-step__icon">○</span>
}

export default function OperationalProcessTodayGroup({
  processDetail,
  profiles = [],
  onOpenRun,
  onStartRun,
  renderRunCard
}) {
  const template = processDetail?.template || {}
  const processRun = processDetail?.process_run || {}
  const progress = getProcessRunProgress(processDetail)
  const steps = processDetail?.steps || []

  const profileName = (id) => {
    if (!id) return "Sin asignar"
    const profile = profiles.find((row) => row.id === id)
    return profile?.full_name || profile?.username || "Sin asignar"
  }

  return (
    <section className="operational-process-group">
      <header className="operational-process-group__head">
        <div>
          <span className="operational-process-group__eyebrow">Proceso operativo</span>
          <h3>{template.title || "Proceso"}</h3>
          {template.area ? <p className="tasks-muted">{template.area}</p> : null}
        </div>
        <div className="operational-process-group__progress">
          <strong>{progress.completed_steps}/{progress.required_steps}</strong>
          <span>{progress.percent}%</span>
          <div className="operational-process-group__bar" aria-hidden="true">
            <div className="operational-process-group__bar-fill" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
          </div>
        </div>
      </header>

      <div className="operational-process-group__steps">
        {steps.map((step) => {
          const run = step.run || null
          const status = getStepDisplayStatus(step, run)
          const unlocked = isProcessStepUnlocked(step, steps, template)

          return (
            <div key={step.id || step.checklist_run_id} className={`operational-process-step${unlocked ? "" : " is-locked"}`}>
              <div className="operational-process-step__label">
                <StepStatusIcon status={status} />
                <div>
                  <strong>{step.step_label}</strong>
                  <small>{profileName(run?.assigned_profile_id || step.checklist_run?.assigned_profile_id)}</small>
                </div>
              </div>
              {run && renderRunCard ? (
                renderRunCard({
                  run,
                  disabled: !unlocked,
                  onOpen: () => (run.status === "pending" || run.status === "rejected" ? onStartRun?.(run.id) : onOpenRun?.(run.id))
                })
              ) : step.checklist_run_id ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={!unlocked}
                  onClick={() => (
                    step.checklist_run?.status === "pending" || step.checklist_run?.status === "rejected"
                      ? onStartRun?.(step.checklist_run_id)
                      : onOpenRun?.(step.checklist_run_id)
                  )}
                >
                  {unlocked ? "Abrir" : "Bloqueada"}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <footer className="operational-process-group__foot">
        <span className={`operational-process-group__status operational-process-group__status--${processRun.status || "pending"}`}>
          {processRun.status === "completed" ? "Proceso completado" : "Proceso en curso"}
        </span>
      </footer>
    </section>
  )
}
