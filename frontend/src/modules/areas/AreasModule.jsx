import "./Areas.css"

export default function AreasModule({
  areas = [],
  areaForm,
  setAreaForm,
  areasError = "",
  areasLoading = false,
  areaProfiles = [],
  editingAreaId = "",
  onGuardarArea,
  onEditarArea,
  onDesactivarArea,
  onReloadAreas,
  onCancelEdit
}) {
  return (
    <div className="areas-module erp-section-stack--large">
      <section className="erp-form-section areas-form-card" aria-labelledby="areas-form-title">
        <header className="erp-module-header">
          <h2 id="areas-form-title">Áreas operativas</h2>
          <p>
            Estas áreas se usan para inventario, producción, requisiciones y colaboradores. No son zonas físicas del restaurante.
          </p>
        </header>

        {areasError ? <p className="areas-status areas-status--error" role="alert">{areasError}</p> : null}

        <div className="areas-form-block">
          <h3>Datos del área</h3>
          <div className="erp-form-grid">
            <div className="erp-field">
              <label htmlFor="area-name">Nombre del área</label>
              <input
                id="area-name"
                value={areaForm.name}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, name: e.target.value }))}
                placeholder="Nombre del área"
              />
            </div>
            <div className="erp-field">
              <label htmlFor="area-type">Tipo</label>
              <select
                id="area-type"
                value={areaForm.type}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, type: e.target.value }))}
              >
                <option value="principal">Principal</option>
                <option value="operativa">Operativa</option>
                <option value="produccion">Producción</option>
                <option value="servicio">Servicio</option>
                <option value="administrativa">Administrativa</option>
                <option value="limpieza">Limpieza</option>
              </select>
            </div>
            <div className="erp-field">
              <label htmlFor="area-responsible">Responsable</label>
              <select
                id="area-responsible"
                value={areaForm.responsibleUserId}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, responsibleUserId: e.target.value }))}
              >
                <option value="">Sin responsable asignado</option>
                {areaProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name || profile.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="erp-field areas-field--full">
              <label htmlFor="area-description">Descripción</label>
              <input
                id="area-description"
                value={areaForm.description}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, description: e.target.value }))}
                placeholder="Descripción"
              />
            </div>
          </div>
        </div>

        <div className="areas-form-block">
          <h3>Opciones</h3>
          <div className="areas-checkbox-row">
            <label className="areas-checkbox-label">
              <input
                type="checkbox"
                checked={areaForm.canRequestInventory}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, canRequestInventory: e.target.checked }))}
              />
              Puede hacer requisiciones
            </label>
            <label className="areas-checkbox-label">
              <input
                type="checkbox"
                checked={areaForm.isProductionArea}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, isProductionArea: e.target.checked }))}
              />
              Área de producción
            </label>
            <label className="areas-checkbox-label">
              <input
                type="checkbox"
                checked={areaForm.active}
                onChange={(e) => setAreaForm((actual) => ({ ...actual, active: e.target.checked }))}
              />
              Área activa
            </label>
          </div>
        </div>

        <div className="areas-form-actions">
          <button type="button" className="erp-btn erp-btn--primary" onClick={onGuardarArea}>
            {editingAreaId ? "Guardar área" : "Crear área"}
          </button>
          <button type="button" className="erp-btn erp-btn--secondary" onClick={onReloadAreas}>
            Actualizar lista
          </button>
          {editingAreaId ? (
            <button type="button" className="erp-btn erp-btn--secondary" onClick={onCancelEdit}>
              Cancelar
            </button>
          ) : null}
        </div>
      </section>

      <section className="erp-section-stack areas-list-section" aria-labelledby="areas-list-title">
        <header className="erp-module-header">
          <h2 id="areas-list-title">Áreas operativas registradas</h2>
        </header>
        {areasLoading ? <p className="areas-status areas-status--loading">Cargando áreas desde Supabase...</p> : null}
        <div className="erp-card-grid">
          {areas.map((area) => (
            <article key={area.id} className="erp-card areas-card">
              <div className="erp-card__header">
                <h3 className="areas-card__title">{area.name}</h3>
                <span className={`erp-badge ${area.active ? "erp-badge--success" : ""}`}>
                  {area.active ? "Activa" : "Inactiva"}
                </span>
              </div>
              <div className="erp-card__body">
                <p className="areas-card__meta"><strong>Tipo:</strong> {area.type}</p>
                <p className="areas-card__meta"><strong>Estado:</strong> {area.active ? "Activa" : "Inactiva"}</p>
                <p className="areas-card__meta">
                  <strong>Requisiciones:</strong> {area.canRequestInventory ? "Permitidas" : "No permitidas"}
                </p>
                <p className="areas-card__meta">
                  <strong>Producción:</strong> {area.isProductionArea ? "Sí" : "No"}
                </p>
                <p className="areas-card__meta">
                  <strong>Responsable:</strong>{" "}
                  {areaProfiles.find((profile) => profile.id === area.responsibleUserId)?.full_name || "Sin asignar"}
                </p>
              </div>
              <div className="erp-card__footer areas-card__footer">
                <button type="button" className="erp-btn areas-btn--edit" onClick={() => onEditarArea(area)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="erp-btn areas-btn--inventory"
                  onClick={() => window.location.assign(`/inventory?section=inventarioAreas&area=${encodeURIComponent(area.id)}`)}
                >
                  Ver inventario
                </button>
                {area.id !== "almacen" && area.active ? (
                  <button type="button" className="erp-btn areas-btn--deactivate" onClick={() => onDesactivarArea(area)}>
                    Desactivar
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
