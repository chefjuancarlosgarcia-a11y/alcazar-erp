import "./operationalTasks.css"

const SKELETON_ROWS = 4

export default function TaskListSkeleton() {
  return (
    <div className="ot-list ot-list--cards ot-list--skeleton" aria-busy="true" aria-label="Cargando tareas">
      {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
        <div key={index} className="ot-task-card-skeleton erp-card" aria-hidden="true">
          <div className="ot-skeleton ot-skeleton--line ot-skeleton--wide" />
          <div className="ot-skeleton ot-skeleton--line" />
          <div className="ot-skeleton-row">
            <div className="ot-skeleton ot-skeleton--badge" />
            <div className="ot-skeleton ot-skeleton--avatar" />
          </div>
        </div>
      ))}
    </div>
  )
}
