import {
  getNextProcessStepToWork,
  getProcessItemTotals,
  getProcessRunProgress,
  getProcessStepLabel,
  getProcessTodaySummary,
  getProcessAssigneeCount,
  getStepDisplayStatus,
  isProcessStepUnlocked
} from "../../utils/operationalProcessProgress"

function formatProcessRunDate(value) {
  if (!value) return "Sin fecha"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

function stepItemTotals(step) {
  const run = step.run || step.checklist_run || null
  if (run?.checklist_run_items?.length) {
    const total = run.checklist_run_items.length
    const completed = run.checklist_run_items.filter((item) => (
      Boolean(
        item?.checked
        || item?.response_text
        || item?.response_number != null
        || item?.response_date
        || item?.response_time
        || item?.photo_url
        || item?.completed_at
        || (item?.response_json && Object.keys(item.response_json).length > 0)
      )
    )).length
    return { completed, total }
  }
  if (run?.item_count != null || run?.completed_items != null) {
    return {
      completed: Number(run.completed_items) || 0,
      total: Number(run.item_count) || 0
    }
  }
  if (step.checklist_run) {
    return {
      completed: Number(step.checklist_run.completed_items) || 0,
      total: Number(step.checklist_run.item_count) || 0
    }
  }
  return { completed: 0, total: 0 }
}

function ProcessStepRow({ step, allSteps, template, onOpenStep }) {
  const run = step.run || step.checklist_run || null
  const unlocked = isProcessStepUnlocked(step, allSteps, template)
  const status = getStepDisplayStatus(step, run)
  const title = getProcessStepLabel(step, run)
  const { completed, total } = stepItemTotals(step)
  const isDone = status === "completed" || status === "pending_review"

  return (
    <article className={`process-detail-step-row process-detail-step-row--${isDone ? "completed" : status}`}>
      <div className="process-detail-step-row__main">
        <h4>
          {isDone ? "✅ " : null}
          {title}
        </h4>
        <p className="process-detail-step-row__items">
          {total > 0 ? `${completed}/${total} tareas completadas` : "Sin ítems cargados"}
        </p>
      </div>
      <button
        type="button"
        className="tasks-secondary process-detail-step-row__action"
        disabled={!unlocked || !run}
        onClick={() => unlocked && run && onOpenStep(step, run)}
      >
        Ver detalle
      </button>
    </article>
  )
}

export default function OperationalProcessTodayDetail({
  processDetail,
  backLabel = "← Volver a Hoy",
  onClose,
  onOpenRun,
  onStartRun,
  onOpenNextStep
}) {
  const template = processDetail?.template || {}
  const summary = getProcessTodaySummary(processDetail)
  const progress = getProcessRunProgress(processDetail)
  const itemTotals = getProcessItemTotals(processDetail)
  const assigneeCount = getProcessAssigneeCount(processDetail)
  const steps = processDetail?.steps || []
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

  const orderedSteps = steps
    .slice()
    .sort((left, right) => (left.step_order ?? 0) - (right.step_order ?? 0))

  return (
    <div className="operational-process-today-detail">
      <div className="checklist-today-toolbar operational-process-today-detail__toolbar">
        <button type="button" className="checklist-back-button" onClick={onClose}>
          {backLabel}
        </button>
      </div>

      <header className={`operational-process-today-detail__head operational-process-today-detail__head--compact operational-process-today-card--${summary.tone}`}>
        <div className="operational-process-today-detail__head-main">
          <span className="operational-process-today-card__eyebrow">Proceso operativo</span>
          <h2>{summary.title}</h2>
          <p className="operational-process-today-detail__head-sub">
            {progress.percent}% completado · {summary.completed} de {summary.total} checklists completadas
            {itemTotals.totalItems > 0 ? ` · ${itemTotals.completedItems} de ${itemTotals.totalItems} tareas completadas` : ""}
          </p>
          <p className="operational-process-today-detail__head-meta">
            Fecha operativa: {formatProcessRunDate(summary.runDate)}
            {assigneeCount > 0 ? ` · Responsables: ${assigneeCount}` : ""}
          </p>
        </div>
        <div className="operational-process-today-detail__head-metrics">
          <div className="operational-process-today-detail__metric">
            <strong>{summary.completed}/{summary.total}</strong>
            <span>checklists</span>
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
        <section className="operational-process-today-detail__group">
          <h3 className="operational-process-today-detail__group-title">Checklists del proceso</h3>
          <div className="process-detail-step-list">
            {orderedSteps.map((step) => (
              <ProcessStepRow
                key={step.id || step.checklist_run_id}
                step={step}
                allSteps={steps}
                template={template}
                onOpenStep={handleOpenStep}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
