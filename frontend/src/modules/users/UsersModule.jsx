import { useMemo } from "react"
import {
  calculateEmployeeScore,
  computeUsersKpis,
  filtrarColaboradores,
  getEmployeeDocuments,
  getEstadoBadgeClass,
  getEstadoColaborador,
  getScoreLabel,
  getUserAuth,
  obtenerInicialesColaborador
} from "./usersHelpers"
import "./Users.css"

const HR_TABS = [
  ["dashboard", "Dashboard RRHH"],
  ["alerts", "Alertas"],
  ["collaborators", "Colaboradores"],
  ["users", "Gestión de usuarios"]
]

export default function UsersModule({
  usuarioActual,
  puedeVerModuloRRHH,
  puedeGestionarUsuarios,
  puedeVerReportesRRHH,
  navigate,
  setSeccionActiva,
  mostrarFormularioColaborador,
  setMostrarFormularioColaborador,
  setMostrarPerfilColaborador,
  setPerfilColaboradorEditando,
  setMensajePerfilColaborador,
  setErroresColaborador,
  setSelectedEmployee,
  editUserId,
  userForm,
  setUserForm,
  erroresColaborador,
  documentoTemp,
  setDocumentoTemp,
  mostrarPerfilColaborador,
  currentHRView,
  setCurrentHRView,
  hrEmployees,
  userSearch,
  setUserSearch,
  hrFilters,
  setHrFilters,
  hrOpenAlerts,
  selectedEmployeeProfile,
  perfilColaboradorEditando,
  mensajePerfilColaborador,
  departamentosDisponibles,
  rolesDisponibles,
  guardarColaboradorValidado,
  limpiarFormularioUsuario,
  setEditUserId,
  actualizarCampoColaborador,
  subirFotoColaborador,
  subirDocumentoColaborador,
  openEmployeeProfile,
  editarUsuario,
  toggleUsuarioActivo,
  obtenerTurnosColaborador,
  renderControlesTurno,
  renderTurnosColaborador,
  renderHRDashboard,
  renderHRAlerts,
  renderHRProfile,
  renderUserManagementView,
  renderStatusBadge,
  getHRBreadcrumb,
  getHRViewTitle
}) {
  const colaboradoresFiltrados = useMemo(
    () => filtrarColaboradores(hrEmployees, userSearch, hrFilters),
    [hrEmployees, userSearch, hrFilters]
  )

  const kpis = useMemo(() => computeUsersKpis(hrEmployees), [hrEmployees])

  const areasDisponibles = useMemo(
    () => [...new Set(hrEmployees.map((u) => u.departamento).filter(Boolean))],
    [hrEmployees]
  )

  function openDashboardRRHH() {
    setMostrarPerfilColaborador(true)
    setMostrarFormularioColaborador(false)
    setPerfilColaboradorEditando(false)
    setMensajePerfilColaborador("")
    setCurrentHRView("dashboard")
    setSelectedEmployee(null)
  }

  function toggleAddCollaboratorForm() {
    setMostrarFormularioColaborador((actual) => !actual)
    setMostrarPerfilColaborador(false)
    setPerfilColaboradorEditando(false)
    setMensajePerfilColaborador("")
    setErroresColaborador({})
  }

  function renderCollaboratorCards() {
    if (colaboradoresFiltrados.length === 0) {
      return (
        <div className="users-empty">
          <strong>Sin resultados</strong>
          <span>No encontramos colaboradores que coincidan con tu búsqueda o filtros.</span>
        </div>
      )
    }

    return (
      <div className="users-card-grid erp-card-grid">
        {colaboradoresFiltrados.map((employee) => {
          const score = calculateEmployeeScore(employee)
          const scoreMeta = getScoreLabel(score)
          const docsVencidos = getEmployeeDocuments(employee).filter((doc) => doc.status === "vencido").length
          const estado = getEstadoColaborador(employee)
          const auth = getUserAuth(employee)
          const contacto = [employee.correo, employee.telefono].filter(Boolean).join(" · ") || "Sin contacto"

          return (
            <article key={employee.id} className="user-card">
              <div className="user-card__header">
                {employee.fotoColaborador ? (
                  <img src={employee.fotoColaborador} alt={employee.nombre} className="user-card__avatar" />
                ) : (
                  <div className="user-card__avatar-placeholder">{obtenerInicialesColaborador(employee.nombre)}</div>
                )}
                <div className="user-card__heading">
                  <h3>{employee.nombre}</h3>
                  <p className="user-card__username">@{auth.username || employee.username || "sin-usuario"}</p>
                  <p className="user-card__meta">{employee.rol || "Sin rol"} · {employee.departamento || "Sin área"}</p>
                </div>
              </div>

              <div className="user-card__tags">
                <span className={`erp-badge ${getEstadoBadgeClass(estado, employee.activo)}`}>{estado}</span>
                <span className={`erp-badge erp-badge--${scoreMeta.tone === "good" ? "success" : scoreMeta.tone === "warning" ? "warning" : scoreMeta.tone === "danger" ? "danger" : "info"}`}>
                  {score === null ? "Sin score" : `${score}%`}
                </span>
                {docsVencidos > 0 && <span className="erp-badge erp-badge--danger">{docsVencidos} docs vencidos</span>}
              </div>

              <div className="user-card__body">
                <p><strong>Puesto:</strong> {employee.puesto || "Sin puesto"}</p>
                <p><strong>Contacto:</strong> {contacto}</p>
              </div>

              <div className="user-card__footer">
                <button type="button" className="erp-btn erp-btn--secondary" onClick={() => openEmployeeProfile(employee)}>
                  Ver
                </button>
                {puedeGestionarUsuarios && !String(employee.id).startsWith("mock-") && (
                  <button type="button" className="erp-btn erp-btn--primary" onClick={() => editarUsuario(employee)}>
                    Editar
                  </button>
                )}
                {puedeGestionarUsuarios && !String(employee.id).startsWith("mock-") && (
                  <button type="button" className="erp-btn erp-btn--secondary" onClick={() => toggleUsuarioActivo(employee.id)}>
                    {employee.activo ? "Desactivar" : "Activar"}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  function renderCollaboratorForm() {
    if (!mostrarFormularioColaborador) return null

    return (
      <section className="erp-card erp-card--form">
        <form onSubmit={guardarColaboradorValidado} className="erp-section-stack--large">
          {Object.keys(erroresColaborador).length > 0 && (
            <div className="users-form-error">
              Faltan campos requeridos: {Object.values(erroresColaborador).join(", ")}.
            </div>
          )}

          <div className="erp-form-section">
            <h3>Información básica</h3>
            <div className="erp-form-grid">
              <div className="erp-field">
                <label htmlFor="users-nombre">Nombre completo</label>
                <input id="users-nombre" placeholder="Nombre completo" value={userForm.nombre} onChange={(e) => actualizarCampoColaborador("nombre", e.target.value)} className={erroresColaborador.nombre ? "is-error" : ""} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-username">Username</label>
                <input id="users-username" placeholder="Username" value={userForm.username} onChange={(e) => actualizarCampoColaborador("username", e.target.value)} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-correo">Correo</label>
                <input id="users-correo" type="email" placeholder="Correo" value={userForm.correo} onChange={(e) => actualizarCampoColaborador("correo", e.target.value)} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-telefono">Teléfono</label>
                <input id="users-telefono" placeholder="Teléfono" value={userForm.telefono} onChange={(e) => setUserForm((s) => ({ ...s, telefono: e.target.value }))} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-departamento">Departamento</label>
                <select id="users-departamento" value={userForm.departamento} onChange={(e) => actualizarCampoColaborador("departamento", e.target.value)}>
                  <option value="">Selecciona departamento</option>
                  {departamentosDisponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="erp-field">
                <label htmlFor="users-puesto">Puesto/Cargo</label>
                <input id="users-puesto" placeholder="Puesto/Cargo" value={userForm.puesto} onChange={(e) => setUserForm((s) => ({ ...s, puesto: e.target.value }))} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-supervisor">Supervisor directo</label>
                <input id="users-supervisor" placeholder="Supervisor directo" value={userForm.supervisorDirecto} onChange={(e) => actualizarCampoColaborador("supervisorDirecto", e.target.value)} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-emergencia">Contacto de emergencia</label>
                <input id="users-emergencia" placeholder="Contacto de emergencia" value={userForm.contactoEmergencia} onChange={(e) => actualizarCampoColaborador("contactoEmergencia", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="erp-form-section">
            <h3>Credenciales y rol</h3>
            <div className="erp-form-grid">
              <div className="erp-field">
                <label htmlFor="users-rol">Rol</label>
                <select id="users-rol" value={userForm.rol} onChange={(e) => actualizarCampoColaborador("rol", e.target.value)}>
                  <option value="">Selecciona rol</option>
                  {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="erp-field">
                <label htmlFor="users-password">Contraseña</label>
                <input id="users-password" type="password" placeholder={editUserId ? "Dejar vacío para no cambiar" : "Contraseña requerida"} value={userForm.password} onChange={(e) => actualizarCampoColaborador("password", e.target.value)} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-estado">Estado</label>
                <select id="users-estado" value={userForm.estado} onChange={(e) => actualizarCampoColaborador("estado", e.target.value)}>
                  <option value="">Estado</option>
                  <option value="Activo">Activo</option>
                  <option value="Suspendido">Suspendido</option>
                  <option value="Inactivo">Inactivo</option>
                  <option value="Retirado">Retirado</option>
                </select>
              </div>
            </div>
          </div>

          <div className="erp-form-section">
            <h3>Fechas</h3>
            <div className="erp-form-grid">
              <div className="erp-field">
                <label htmlFor="users-inicio">Fecha de inicio de labores</label>
                <input id="users-inicio" type="date" value={userForm.fechaInicioLabores} onChange={(e) => actualizarCampoColaborador("fechaInicioLabores", e.target.value)} />
              </div>
              <div className="erp-field">
                <label htmlFor="users-cumple">Fecha de nacimiento</label>
                <input id="users-cumple" type="date" value={userForm.fechaCumpleanos} onChange={(e) => setUserForm((s) => ({ ...s, fechaCumpleanos: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="erp-form-section">
            <h3>Horario / turnos</h3>
            {renderControlesTurno("Agregar turno")}
            {renderTurnosColaborador(obtenerTurnosColaborador(userForm), true)}
            {erroresColaborador.turnos && <p className="users-form-error">{erroresColaborador.turnos}</p>}
          </div>

          <div className="erp-form-section">
            <h3>Fotografía</h3>
            <div className="erp-field">
              <input type="file" accept="image/*" onChange={subirFotoColaborador} />
            </div>
            {userForm.fotoColaborador && (
              <img src={userForm.fotoColaborador} alt="Foto" className="users-form-photo-preview" />
            )}
          </div>

          <div className="erp-form-section">
            <h3>Documentos</h3>
            <div className="erp-form-grid">
              <div className="erp-field">
                <label htmlFor="users-doc-tipo">Tipo</label>
                <select id="users-doc-tipo" value={documentoTemp.tipo} onChange={(e) => setDocumentoTemp((s) => ({ ...s, tipo: e.target.value }))}>
                  <option value="dpiFrontal">DPI Frontal</option>
                  <option value="dpiReverso">DPI Reverso</option>
                  <option value="tarjetaSalud">Tarjeta de Salud</option>
                  <option value="tarjetaManipulacionAlimentos">Tarjeta de Manipulación de Alimentos</option>
                  <option value="otros">Otros</option>
                </select>
              </div>
              <div className="erp-field">
                <label htmlFor="users-doc-file">Archivo</label>
                <input id="users-doc-file" type="file" onChange={subirDocumentoColaborador} />
              </div>
            </div>
            <div className="erp-section-stack">
              {userForm.documentos.dpiFrontal && <div className="users-form-doc-row">✓ DPI Frontal cargado</div>}
              {userForm.documentos.dpiReverso && <div className="users-form-doc-row">✓ DPI Reverso cargado</div>}
              {userForm.documentos.tarjetaSalud && <div className="users-form-doc-row">✓ Tarjeta de Salud cargada</div>}
              {userForm.documentos.tarjetaManipulacionAlimentos && <div className="users-form-doc-row">✓ Tarjeta de Manipulación cargada</div>}
            </div>
          </div>

          <div className="erp-form-section">
            <h3>Observaciones adicionales</h3>
            <div className="erp-field">
              <textarea placeholder="Notas sobre el colaborador..." value={userForm.observaciones} onChange={(e) => setUserForm((s) => ({ ...s, observaciones: e.target.value }))} />
            </div>
          </div>

          <div className="users-form-actions">
            <button type="submit" className="erp-btn erp-btn--primary">
              {editUserId ? "Actualizar Colaborador" : "Crear Colaborador"}
            </button>
            <button
              type="button"
              className="erp-btn erp-btn--secondary"
              onClick={() => {
                setEditUserId(null)
                limpiarFormularioUsuario()
                setMostrarFormularioColaborador(false)
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </section>
    )
  }

  function renderCollaboratorsView() {
    return (
      <div className="erp-section-stack--large">
        <div className="users-kpi-grid erp-kpi-grid">
          <div className="erp-kpi-card">
            <span>Total usuarios</span>
            <strong>{kpis.total}</strong>
          </div>
          <div className="erp-kpi-card">
            <span>Activos</span>
            <strong>{kpis.activos}</strong>
          </div>
          <div className="erp-kpi-card">
            <span>Inactivos / otros</span>
            <strong>{kpis.inactivos}</strong>
          </div>
          <div className="erp-kpi-card users-kpi-types">
            <span>Por rol</span>
            <strong>
              {kpis.porRol.length ? kpis.porRol.map(([rol, count]) => `${rol} (${count})`).join(" · ") : "Sin datos"}
            </strong>
          </div>
        </div>

        <div className="users-filters erp-filters-row erp-filters-row--grouped">
          <div className="users-filters__search erp-field">
            <label htmlFor="users-search">Buscar colaboradores</label>
            <input
              id="users-search"
              className="erp-search-input"
              placeholder="Buscar por nombre, puesto o área..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          </div>
          <div className="erp-field">
            <label htmlFor="users-filter-puesto">Puesto</label>
            <input id="users-filter-puesto" placeholder="Filtrar por puesto" value={hrFilters.puesto} onChange={(e) => setHrFilters((s) => ({ ...s, puesto: e.target.value }))} />
          </div>
          <div className="erp-field">
            <label htmlFor="users-filter-area">Área</label>
            <select id="users-filter-area" value={hrFilters.departamento} onChange={(e) => setHrFilters((s) => ({ ...s, departamento: e.target.value }))}>
              <option value="">Todas las áreas</option>
              {areasDisponibles.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div className="erp-field">
            <label htmlFor="users-filter-estado">Estado</label>
            <select id="users-filter-estado" value={hrFilters.estado} onChange={(e) => setHrFilters((s) => ({ ...s, estado: e.target.value }))}>
              <option value="">Todos los estados</option>
              <option value="Activo">Activo</option>
              <option value="Suspendido">Suspendido</option>
              <option value="Inactivo">Inactivo</option>
              <option value="Retirado">Retirado</option>
            </select>
          </div>
          <div className="erp-field">
            <label htmlFor="users-filter-especial">Filtro especial</label>
            <select id="users-filter-especial" value={hrFilters.especial} onChange={(e) => setHrFilters((s) => ({ ...s, especial: e.target.value }))}>
              <option value="">Sin filtro especial</option>
              <option value="docsVencidos">Documentos vencidos</option>
              <option value="docsPorVencer">Documentos por vencer</option>
              <option value="bajoDesempeno">Bajo desempeño</option>
              <option value="cumpleanos">Cumpleaños próximos</option>
              <option value="capacitaciones">Capacitaciones pendientes</option>
            </select>
          </div>
          <div className="erp-field">
            <label htmlFor="users-filter-orden">Ordenar</label>
            <select id="users-filter-orden" value={hrFilters.ordenar} onChange={(e) => setHrFilters((s) => ({ ...s, ordenar: e.target.value }))}>
              <option value="nombre">Ordenar por nombre</option>
              <option value="fechaIngreso">Fecha de ingreso</option>
              <option value="score">Score general</option>
              <option value="puntualidad">Puntualidad</option>
              <option value="documentos">Documentos vencidos</option>
              <option value="antiguedad">Antigüedad</option>
            </select>
          </div>
        </div>

        <span className="users-count-label">
          {colaboradoresFiltrados.length} de {hrEmployees.length} colaboradores
        </span>

        {renderCollaboratorCards()}
      </div>
    )
  }

  if (!usuarioActual) {
    return (
      <div className="erp-page-shell users-module">
        <p className="users-permission-muted">Inicia sesión para administrar usuarios.</p>
      </div>
    )
  }

  if (!puedeVerModuloRRHH) {
    return (
      <div className="erp-page-shell users-module">
        <p className="users-permission-denied">No tienes permisos para ver el módulo de usuarios.</p>
      </div>
    )
  }

  const tabs = HR_TABS.filter(([key]) => key !== "users" || puedeGestionarUsuarios)

  return (
    <div className="erp-page-shell users-module erp-section-stack--large">
      <header className="users-module__header erp-module-header">
        <h2>Gestión de Usuarios</h2>
        <p>Recursos Humanos — colaboradores, perfiles y accesos.</p>
      </header>

      <div className="users-action-bar">
        {puedeGestionarUsuarios && (
          <button type="button" className="erp-btn erp-btn--primary" onClick={toggleAddCollaboratorForm}>
            + Agregar colaborador nuevo
          </button>
        )}
        <button type="button" className="erp-btn erp-btn--secondary" onClick={openDashboardRRHH}>
          Dashboard RRHH
        </button>
        <button type="button" className="erp-btn erp-btn--secondary" onClick={() => navigate("/hr?section=asistencia")}>
          Marcaje de asistencia
        </button>
        {puedeVerReportesRRHH && (
          <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setSeccionActiva("reportesAsistencia")}>
            Reportes de asistencia
          </button>
        )}
      </div>

      {renderCollaboratorForm()}

      {mostrarPerfilColaborador && (
        <section className="users-hr-shell erp-card erp-card--form">
          <div className="users-hr-context">
            <div className="users-breadcrumb">{getHRBreadcrumb()}</div>
            <h2 className="users-hr-title">{getHRViewTitle()}</h2>
          </div>

          <div className="users-tab-bar">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`erp-btn erp-btn--secondary${currentHRView === key ? " is-active" : ""}`}
                onClick={() => {
                  setCurrentHRView(key)
                  if (key !== "employeeProfile") setSelectedEmployee(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {currentHRView === "dashboard" && (
            <div className="users-legacy-delegated">{renderHRDashboard()}</div>
          )}

          {currentHRView === "alerts" && (
            <div className="users-legacy-delegated erp-card">
              <h3>Alertas de RRHH</h3>
              {renderHRAlerts(hrOpenAlerts)}
            </div>
          )}

          {currentHRView === "collaborators" && renderCollaboratorsView()}

          {currentHRView === "employeeProfile" && (
            <>
              {mensajePerfilColaborador && (
                <div className="users-success-banner">{mensajePerfilColaborador}</div>
              )}
              {perfilColaboradorEditando ? null : (
                <div className="users-legacy-delegated">{renderHRProfile(selectedEmployeeProfile)}</div>
              )}
            </>
          )}

          {currentHRView === "users" && (
            <div className="users-legacy-delegated">{renderUserManagementView()}</div>
          )}
        </section>
      )}
    </div>
  )
}
