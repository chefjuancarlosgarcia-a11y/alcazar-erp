import { OPERATIONAL_TASK_BOARD_COLUMNS } from "../../config/operationalTasksConfig"
import "./operationalTasks.css"

const SKELETON_CARDS_PER_COLUMN = 3

export default function TaskBoardSkeleton() {
  return (
    <div className="ot-kanban ot-kanban--skeleton" aria-busy="true" aria-label="Cargando tablero">
      {OPERATIONAL_TASK_BOARD_COLUMNS.map((column) => (
        <section key={column.id} className="ot-kanban-column ot-kanban-column--skeleton">
          <div className="ot-kanban-column__head">
            <div className="ot-skeleton ot-skeleton--title" />
            <div className="ot-skeleton ot-skeleton--count" />
          </div>
          <div className="ot-kanban-column__cards">
            {Array.from({ length: SKELETON_CARDS_PER_COLUMN }).map((_, index) => (
              <div key={index} className="ot-task-card-skeleton erp-card" aria-hidden="true">
                <div className="ot-skeleton ot-skeleton--line ot-skeleton--wide" />
                <div className="ot-skeleton ot-skeleton--line" />
                <div className="ot-skeleton-row">
                  <div className="ot-skeleton ot-skeleton--badge" />
                  <div className="ot-skeleton ot-skeleton--badge" />
                </div>
                <div className="ot-skeleton ot-skeleton--line ot-skeleton--short" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
