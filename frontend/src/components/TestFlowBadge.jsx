import "./TestFlowBadge.css"

export function TestFlowBadge({ className = "" }) {
  return <span className={`test-flow-badge${className ? ` ${className}` : ""}`}>PRUEBA</span>
}

export function TestFlowWarning({ className = "" }) {
  return (
    <p className={`test-flow-warning${className ? ` ${className}` : ""}`} role="note">
      Esta es una prueba. No afecta inventario real ni reportes operativos.
    </p>
  )
}

export function TestFlowControls({
  filter,
  onFilterChange,
  canCreate = false,
  createActive = false,
  onToggleCreate,
  className = ""
}) {
  return (
    <div className={`test-flow-controls${className ? ` ${className}` : ""}`}>
      <div className="test-flow-filters" role="group" aria-label="Filtrar operación real o pruebas">
        <button type="button" className={filter === "real" ? "active" : ""} onClick={() => onFilterChange("real")}>
          Ver operación real
        </button>
        <button type="button" className={filter === "test" ? "active" : ""} onClick={() => onFilterChange("test")}>
          Ver pruebas
        </button>
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => onFilterChange("all")}>
          Ver todo
        </button>
      </div>
      {canCreate && (
        <button
          type="button"
          className={`test-flow-create-btn${createActive ? " active" : ""}`}
          onClick={onToggleCreate}
        >
          Crear prueba de flujo
        </button>
      )}
    </div>
  )
}
