import {
  getNextProcessStepToWork,
  getProcessRunProgress,
  getProcessStepLabel,
  getProcessTodaySummary,
  isProcessStepUnlocked,
  partitionProcessStepsForDetail
} from "../../utils/operationalProcessProgress"

function ProcessStepGrid({ steps, allSteps, template, renderRunCard, onOpenStep }) {
  if (!steps.length) return null

  return (
    <div className="process-detail-checklist-grid">
      {steps.map((step) => {
        const run = step.run || null
        const unlocked = isProcessStepUnlocked(step, allSteps, template)

        return (
          <div key={step.id || step.checklist_run_id} className="process-detail-checklist-grid__item">
            {run && renderRunCard ? (
              renderRunCard({
                run,
                step,
                disabled: !unlocked,
                onOpen: () => unlocked && onOpenStep(step, run)
              })
            ) : step.checklist_run_id ? (
              <article className="process-child-card process-child-card--pending is-locked">
                <div className="process-child-card__body">
                  <h3>{step.step_label}</h3>
                  <p className="process-child-card__status-line">Pendiente</p>
                  <p className="process-child-card__items">Sin corrida</p>
                </div>
                <div className="process-child-card__actions">
                  <button type="button" className="checklist-primary-action" disabled>Bloqueada</button>
                </div>
              </article>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default function OperationalProcessTodayDetail({
  processDetail,
  profiles = [],
  onClose,
  onOpenRun,
  onStartRun,
  onOpenNextStep,
  renderRunCard
}) {
  const template = processDetail?.template || {}
  const summary = getProcessTodaySummary(processDetail)
  const progress = getProcessRunProgress(processDetail)
  const steps = processDetail?.steps || []
  const stepGroups = partitionProcessStepsForDetail(steps)
  const nextStep = getNextProcessStepToWork(processDetail)
  const nextStepLabel = nextStep ? getProcessStepLabel(nextStep, nextStep.run || null) : ""

  const handleOpenStep = (step, run) => {
    const targetRun = run || step.checklist_run
    const runId = run?.id || step.checklist_run_id
    if (!runId) return
    if (targetRun?.status === "pending" || targetRun?.status === "rejected") {
      onStartRun?.(runId)
    } else {
      onOpenRun?.(runId)
    }
  }

  const handleOpenNext = () => {
    if (!nextStep) return
    handleOpenStep(nextStep, nextStep.run || null)
    onOpenNextStep?.(nextStep)
  }

  return (
    <div className="operational-process-today-detail">
      <div className="checklist-today-toolbar operational-process-today-detail__toolbar">
        <button type="button" className="checklist-back-button" onClick={onClose}>
          ← Volver a checklists de hoy
        </button>
      </div>

      <header className={`operational-process-today-detail__head operational-process-today-detail__head--compact operational-process-today-card--${summary.tone}`}>
        <div className="operational-process-today-detail__head-main">
          <span className="operational-process-today-card__eyebrow">Proceso operativo</span>
          <h2>{summary.title}</h2>
        </div>
        <div className="operational-process-today-detail__head-metrics">
          <div className="operational-process-today-detail__metric">
            <strong>{summary.completed}/{summary.total}</strong>
            <span>completadas</span>
          </div>
          <span className={`operational-process-today-card__status operational-process-today-card__status--${summary.tone}`}>
            {summary.label}
          </span>
          <div className="operational-process-today-detail__metric-bar" aria-hidden="true">
            <div style={{ width: `${Math.min(progress.percent, 100)}%` }} />
          </div>
          <span className="operational-process-today-detail__metric-percent">{progress.percent}%</span>
        </div>
      </header>

      {nextStep ? (
        <button
          type="button"
          className="operational-process-today-detail__cta"
          onClick={handleOpenNext}
        >
          <span className="operational-process-today-detail__cta-main">Continuar proceso</span>
          <span className="operational-process-today-detail__cta-sub">Siguiente: {nextStepLabel}</span>
        </button>
      ) : null}

      <div className="operational-process-today-detail__body">
        {stepGroups.map((group) => (
          <section key={group.key} className="operational-process-today-detail__group">
            <h3 className="operational-process-today-detail__group-title">{group.label}</h3>

            <ProcessStepGrid
              steps={group.activeSteps}
              allSteps={steps}
              template={template}
              renderRunCard={renderRunCard}
              onOpenStep={handleOpenStep}
            />

            {group.completedSteps.length > 0 ? (
              <details className="process-detail-completed-block">
                <summary>Completadas ({group.completedSteps.length})</summary>
                <ProcessStepGrid
                  steps={group.completedSteps}
                  allSteps={steps}
                  template={template}
                  renderRunCard={renderRunCard}
                  onOpenStep={handleOpenStep}
                />
              </details>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  )
}
