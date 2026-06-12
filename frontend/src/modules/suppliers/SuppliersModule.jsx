import { useMemo, useState } from "react"
import { createSupplier, updateSupplier } from "../../services/suppliersService"
import { generarCodigoProveedor } from "../../utils"
import {
  PROVEEDOR_DIAS_ENTREGA_INICIAL,
  PROVEEDOR_METODOS_PAGO_INICIAL,
  PROVEEDOR_TIEMPOS_ENTREGA,
  PROVEEDOR_TIPOS,
  filtrarProveedoresFormulario,
  filtrarProveedoresLista,
  formatearDiasEntregaProveedor,
  formatearMetodosPagoProveedor,
  normalizarUrlProveedor,
  obtenerContactoPrincipalProveedor,
  obtenerProveedoresSimilares,
  obtenerTelefonoWhatsAppProveedor,
  obtenerTelefonosProveedor,
  obtenerUltimasComprasProveedor,
  renderEstrellasProveedor
} from "./suppliersHelpers"
import "./Suppliers.css"

export default function SuppliersModule({
  ingredientes = [],
  proveedores = [],
  proveedoresLoading = false,
  proveedoresError = "",
  proveedoresMigracion = "",
  onReloadProveedores,
  onNotify
}) {
  const [formBusqueda, setFormBusqueda] = useState("")
  const [listaBusqueda, setListaBusqueda] = useState("")
  const [seleccionadoPrincipalId, setSeleccionadoPrincipalId] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [nombreComercial, setNombreComercial] = useState("")
  const [razonSocial, setRazonSocial] = useState("")
  const [nit, setNit] = useState("")
  const [tipo, setTipo] = useState("Lácteos")
  const [encargado, setEncargado] = useState("")
  const [telefono, setTelefono] = useState("")
  const [telefono2, setTelefono2] = useState("")
  const [telefono3, setTelefono3] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [correo, setCorreo] = useState("")
  const [paginaWeb, setPaginaWeb] = useState("")
  const [direccion, setDireccion] = useState("")
  const [metodosPago, setMetodosPago] = useState({ ...PROVEEDOR_METODOS_PAGO_INICIAL })
  const [cuentaBancaria, setCuentaBancaria] = useState("")
  const [banco, setBanco] = useState("")
  const [diasEntrega, setDiasEntrega] = useState({ ...PROVEEDOR_DIAS_ENTREGA_INICIAL })
  const [tiempoEntrega, setTiempoEntrega] = useState("mismo dia")
  const [estrellas, setEstrellas] = useState(3)

  const proveedoresFormularioFiltrados = useMemo(
    () => filtrarProveedoresFormulario(proveedores, formBusqueda),
    [proveedores, formBusqueda]
  )

  const proveedoresListaFiltrados = useMemo(
    () => filtrarProveedoresLista(proveedores, listaBusqueda),
    [proveedores, listaBusqueda]
  )

  const proveedoresActivosCount = useMemo(
    () => proveedores.filter((proveedor) => (proveedor.status || "active") === "active").length,
    [proveedores]
  )

  const proveedoresTiposResumen = useMemo(
    () =>
      Object.entries(
        proveedores.reduce((acc, proveedor) => {
          const tipoProveedor = String(proveedor.tipo || "Sin tipo").trim() || "Sin tipo"
          acc[tipoProveedor] = (acc[tipoProveedor] || 0) + 1
          return acc
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 4),
    [proveedores]
  )

  const proveedorSeleccionadoPrincipal = useMemo(
    () => proveedores.find((proveedor) => proveedor.id === seleccionadoPrincipalId) || null,
    [proveedores, seleccionadoPrincipalId]
  )

  const productosProveedorSeleccionado = useMemo(
    () =>
      proveedorSeleccionadoPrincipal
        ? ingredientes.filter((ingrediente) => ingrediente.proveedorId === proveedorSeleccionadoPrincipal.id)
        : [],
    [ingredientes, proveedorSeleccionadoPrincipal]
  )

  const proveedoresSimilares = useMemo(
    () =>
      proveedorSeleccionadoPrincipal
        ? obtenerProveedoresSimilares(proveedorSeleccionadoPrincipal, proveedores, ingredientes)
        : [],
    [proveedorSeleccionadoPrincipal, proveedores, ingredientes]
  )

  function limpiarFormulario() {
    setEditandoId(null)
    setNombreComercial("")
    setRazonSocial("")
    setNit("")
    setTipo("Lácteos")
    setEncargado("")
    setTelefono("")
    setTelefono2("")
    setTelefono3("")
    setWhatsapp("")
    setCorreo("")
    setPaginaWeb("")
    setDireccion("")
    setMetodosPago({ ...PROVEEDOR_METODOS_PAGO_INICIAL })
    setCuentaBancaria("")
    setBanco("")
    setDiasEntrega({ ...PROVEEDOR_DIAS_ENTREGA_INICIAL })
    setTiempoEntrega("mismo dia")
    setEstrellas(3)
    setFormBusqueda("")
  }

  async function guardarProveedor() {
    if (!nombreComercial.trim()) {
      alert("Ingresa el nombre comercial del proveedor.")
      return
    }

    const telefonosProveedor = [telefono, telefono2, telefono3]
      .map((item) => item.trim())
      .filter(Boolean)
    const proveedorExistente = editandoId ? proveedores.find((p) => p.id === editandoId) : null
    const nuevoProveedor = {
      id: editandoId || undefined,
      codigo: editandoId ? proveedorExistente?.codigo : generarCodigoProveedor(proveedores.length),
      nombreComercial,
      razonSocial,
      nit,
      tipo,
      encargado,
      telefono: telefonosProveedor[0] || "",
      telefonos: telefonosProveedor,
      whatsapp,
      correo,
      paginaWeb,
      direccion,
      metodosPago,
      cuentaBancaria,
      banco,
      diasEntrega,
      tiempoEntrega,
      estrellas,
      historialCompras: proveedorExistente?.historialCompras || [],
      creado: proveedorExistente?.creado || new Date().toLocaleString()
    }

    if (editandoId) {
      const result = await updateSupplier(editandoId, nuevoProveedor)
      if (result.error) {
        alert(result.error.message || "No se pudo actualizar el proveedor.")
        return
      }
      await onReloadProveedores?.()
      alert("Proveedor actualizado.")
    } else {
      const result = await createSupplier(nuevoProveedor)
      if (result.error) {
        alert(result.error.message || "No se pudo crear el proveedor.")
        return
      }
      await onReloadProveedores?.()
      if (nuevoProveedor.correo && onNotify) {
        onNotify(
          `correo-proveedor-${result.data?.id || Date.now()}`,
          "correo",
          `Nuevo proveedor con correo registrado: ${nuevoProveedor.nombreComercial}.`
        )
      }
      alert("Proveedor creado.")
    }
    limpiarFormulario()
  }

  function editarProveedor(proveedor) {
    const telefonos = Array.isArray(proveedor.telefonos) && proveedor.telefonos.length
      ? proveedor.telefonos
      : [proveedor.telefono || "", proveedor.telefono2 || "", proveedor.telefono3 || ""]
    setEditandoId(proveedor.id)
    setNombreComercial(proveedor.nombreComercial || "")
    setRazonSocial(proveedor.razonSocial || "")
    setNit(proveedor.nit || "")
    setTipo(proveedor.tipo || "Lácteos")
    setEncargado(proveedor.encargado || "")
    setTelefono(telefonos[0] || "")
    setTelefono2(telefonos[1] || "")
    setTelefono3(telefonos[2] || "")
    setWhatsapp(proveedor.whatsapp || "")
    setCorreo(proveedor.correo || "")
    setPaginaWeb(proveedor.paginaWeb || proveedor.website || "")
    setDireccion(proveedor.direccion || "")
    setMetodosPago(proveedor.metodosPago || { ...PROVEEDOR_METODOS_PAGO_INICIAL })
    setCuentaBancaria(proveedor.cuentaBancaria || "")
    setBanco(proveedor.banco || "")
    setDiasEntrega(proveedor.diasEntrega || { ...PROVEEDOR_DIAS_ENTREGA_INICIAL })
    setTiempoEntrega(proveedor.tiempoEntrega || "mismo dia")
    setEstrellas(proveedor.estrellas || 3)
    setFormBusqueda(proveedor.nombreComercial || "")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function toggleMetodoPago(metodo) {
    setMetodosPago((prev) => ({
      ...prev,
      [metodo]: !prev[metodo]
    }))
  }

  function toggleDiaEntrega(dia) {
    setDiasEntrega((prev) => ({
      ...prev,
      [dia]: !prev[dia]
    }))
  }

  function toggleTodosDiasEntrega() {
    const seleccionarTodos = Object.values(diasEntrega).some((habilitado) => !habilitado)
    setDiasEntrega(Object.fromEntries(Object.keys(diasEntrega).map((dia) => [dia, seleccionarTodos])))
  }

  function renderPerfilBasico(proveedor) {
    const websiteUrl = normalizarUrlProveedor(proveedor.paginaWeb || proveedor.website)
    const diasActivos = Object.entries(proveedor.diasEntrega || {})
      .filter(([, enabled]) => enabled)
      .map(([dia]) => dia.charAt(0).toUpperCase() + dia.slice(1))
      .join(", ")

    return (
      <>
        <p><strong>Código:</strong> {proveedor.codigo || "No definido"}</p>
        <p><strong>Razón social:</strong> {proveedor.razonSocial || "No definido"}</p>
        <p><strong>NIT:</strong> {proveedor.nit || "No definido"}</p>
        <p><strong>Encargado:</strong> {proveedor.encargado || "No definido"}</p>
        <p><strong>Teléfonos:</strong> {obtenerTelefonosProveedor(proveedor).join(" / ") || "No definido"}</p>
        <p><strong>WhatsApp:</strong> {proveedor.whatsapp || "No definido"}</p>
        <p><strong>Correo:</strong> {proveedor.correo || "No definido"}</p>
        <p>
          <strong>Página web:</strong>{" "}
          {websiteUrl ? (
            <a href={websiteUrl} target="_blank" rel="noreferrer">
              {proveedor.paginaWeb || proveedor.website}
            </a>
          ) : (
            "No definido"
          )}
        </p>
        <p><strong>Dirección:</strong> {proveedor.direccion || "No definido"}</p>
        <p><strong>Días de entrega:</strong> {diasActivos || "No definido"}</p>
      </>
    )
  }

  return (
    <div className="suppliers-module erp-section-stack--large">
      <section className="erp-card erp-card--form suppliers-form-card">
        <div className="suppliers-form-card__intro erp-module-header">
          <h2>{editandoId ? "Editar proveedor" : "Crear proveedor"}</h2>
          <p>Registra el proveedor con toda su información de contacto, pagos y días de entrega.</p>
        </div>

        {proveedoresLoading && <p className="suppliers-status suppliers-status--loading">Cargando proveedores desde Supabase...</p>}
        {proveedoresError && <p className="suppliers-status suppliers-status--error">{proveedoresError}</p>}
        {proveedoresMigracion && <p className="suppliers-status suppliers-status--success">{proveedoresMigracion}</p>}

        <div className="erp-form-section">
          <h3>Buscar proveedor existente</h3>
          <div className="suppliers-autocomplete erp-field">
            <label htmlFor="suppliers-form-search">Buscar proveedor</label>
            <input
              id="suppliers-form-search"
              type="text"
              className="erp-search-input"
              placeholder="Busca por nombre, razón social o código..."
              value={formBusqueda}
              onChange={(e) => setFormBusqueda(e.target.value)}
            />
            {formBusqueda && proveedoresFormularioFiltrados.length > 0 && (
              <div className="suppliers-suggestions">
                {proveedoresFormularioFiltrados.slice(0, 8).map((proveedor) => (
                  <button
                    key={proveedor.id}
                    type="button"
                    className="suppliers-suggestion-btn"
                    onClick={() => editarProveedor(proveedor)}
                  >
                    {proveedor.nombreComercial} ({proveedor.codigo})
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="erp-form-section">
          <h3>Datos generales</h3>
          <div className="erp-form-grid">
            <div className="erp-field">
              <label htmlFor="suppliers-nombre">Nombre comercial</label>
              <input id="suppliers-nombre" type="text" placeholder="Nombre comercial" value={nombreComercial} onChange={(e) => setNombreComercial(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-razon">Razón social</label>
              <input id="suppliers-razon" type="text" placeholder="Razón social" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-nit">NIT</label>
              <input id="suppliers-nit" type="text" placeholder="NIT" value={nit} onChange={(e) => setNit(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-tipo">Tipo de proveedor</label>
              <select id="suppliers-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {PROVEEDOR_TIPOS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="erp-form-section">
          <h3>Contacto</h3>
          <div className="erp-form-grid">
            <div className="erp-field">
              <label htmlFor="suppliers-encargado">Persona encargada</label>
              <input id="suppliers-encargado" type="text" placeholder="Persona encargada" value={encargado} onChange={(e) => setEncargado(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-tel1">Teléfono</label>
              <input id="suppliers-tel1" type="text" placeholder="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-tel2">Teléfono 2</label>
              <input id="suppliers-tel2" type="text" placeholder="Teléfono 2" value={telefono2} onChange={(e) => setTelefono2(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-tel3">Teléfono 3</label>
              <input id="suppliers-tel3" type="text" placeholder="Teléfono 3" value={telefono3} onChange={(e) => setTelefono3(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-whatsapp">WhatsApp</label>
              <input id="suppliers-whatsapp" type="text" placeholder="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-correo">Correo electrónico</label>
              <input id="suppliers-correo" type="email" placeholder="Correo electrónico" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-web">Página web</label>
              <input id="suppliers-web" type="url" placeholder="Página web" value={paginaWeb} onChange={(e) => setPaginaWeb(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-direccion">Dirección</label>
              <input id="suppliers-direccion" type="text" placeholder="Dirección" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="erp-form-section">
          <h3>Pagos y entrega</h3>
          <div className="suppliers-checkbox-grid">
            <span className="erp-field label">Métodos de pago</span>
            {Object.keys(metodosPago).map((metodo) => (
              <label key={metodo} className="suppliers-checkbox-label">
                <input type="checkbox" checked={metodosPago[metodo]} onChange={() => toggleMetodoPago(metodo)} />
                {metodo.charAt(0).toUpperCase() + metodo.slice(1)}
              </label>
            ))}
          </div>
          <div className="erp-form-grid">
            <div className="erp-field">
              <label htmlFor="suppliers-cuenta">Cuenta bancaria</label>
              <input id="suppliers-cuenta" type="text" placeholder="Cuenta bancaria" value={cuentaBancaria} onChange={(e) => setCuentaBancaria(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-banco">Banco</label>
              <input id="suppliers-banco" type="text" placeholder="Banco" value={banco} onChange={(e) => setBanco(e.target.value)} />
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-tiempo">Tiempo promedio de entrega</label>
              <select id="suppliers-tiempo" value={tiempoEntrega} onChange={(e) => setTiempoEntrega(e.target.value)}>
                {PROVEEDOR_TIEMPOS_ENTREGA.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="erp-field">
              <label htmlFor="suppliers-estrellas">Clasificación por estrellas</label>
              <select id="suppliers-estrellas" value={estrellas} onChange={(e) => setEstrellas(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} estrella{n > 1 ? "s" : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="suppliers-checkbox-grid">
            <label className="suppliers-checkbox-label suppliers-checkbox-label--bold">
              <input type="checkbox" checked={Object.values(diasEntrega).every(Boolean)} onChange={toggleTodosDiasEntrega} />
              Seleccionar todos los días
            </label>
            <div className="suppliers-checkbox-grid suppliers-checkbox-grid--days">
              {Object.keys(diasEntrega).map((dia) => (
                <label key={dia} className="suppliers-checkbox-label">
                  <input type="checkbox" checked={diasEntrega[dia]} onChange={() => toggleDiaEntrega(dia)} />
                  {dia.charAt(0).toUpperCase() + dia.slice(1)}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="suppliers-form-actions">
          <button type="button" className="erp-btn erp-btn--primary" onClick={guardarProveedor}>
            {editandoId ? "Actualizar proveedor" : "Guardar proveedor"}
          </button>
          <button type="button" className="erp-btn erp-btn--secondary" onClick={limpiarFormulario}>
            Limpiar
          </button>
        </div>
      </section>

      <section className="erp-card suppliers-board">
        <div className="suppliers-board__intro erp-module-header">
          <h2>Directorio de proveedores</h2>
          <p>Consulta, filtra y abre el perfil de cada proveedor desde el tablero.</p>
        </div>

        <div className="suppliers-summary erp-kpi-grid">
          <div className="suppliers-kpi erp-kpi-card">
            <span>Total proveedores</span>
            <strong>{proveedores.length}</strong>
          </div>
          <div className="suppliers-kpi erp-kpi-card">
            <span>Proveedores activos</span>
            <strong>{proveedoresActivosCount}</strong>
          </div>
          <div className="suppliers-kpi suppliers-kpi-types erp-kpi-card">
            <span>Tipos más usados</span>
            <strong>
              {proveedoresTiposResumen.length
                ? proveedoresTiposResumen.map(([tipoProveedor, count]) => `${tipoProveedor} (${count})`).join(" · ")
                : "Sin datos"}
            </strong>
          </div>
        </div>

        <div className="suppliers-toolbar erp-filters-row">
          <input
            type="search"
            className="suppliers-search erp-search-input"
            placeholder="Buscar por nombre, razón social, código, tipo o contacto..."
            value={listaBusqueda}
            onChange={(e) => setListaBusqueda(e.target.value)}
          />
          <span className="suppliers-count-label">
            {proveedoresListaFiltrados.length} de {proveedores.length} proveedores
          </span>
        </div>

        {proveedorSeleccionadoPrincipal && (
          <div className="suppliers-profile-panel">
            <h3>Perfil de {proveedorSeleccionadoPrincipal.nombreComercial}</h3>
            {renderPerfilBasico(proveedorSeleccionadoPrincipal)}
            <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setSeleccionadoPrincipalId(null)}>
              Cerrar perfil
            </button>
          </div>
        )}

        {proveedores.length === 0 ? (
          <div className="suppliers-empty">
            <strong>No hay proveedores registrados</strong>
            <span>Usa el formulario de arriba para crear el primero.</span>
          </div>
        ) : proveedoresListaFiltrados.length === 0 ? (
          <div className="suppliers-empty">
            <strong>Sin resultados</strong>
            <span>No encontramos proveedores que coincidan con tu búsqueda.</span>
          </div>
        ) : (
          <div className="suppliers-card-grid erp-card-grid">
            {proveedoresListaFiltrados.map((proveedor) => {
              const metodosPagoLabels = formatearMetodosPagoProveedor(proveedor.metodosPago)
              const diasEntregaLabels = formatearDiasEntregaProveedor(proveedor.diasEntrega)
              const telefonoWhatsApp = obtenerTelefonoWhatsAppProveedor(proveedor)
              return (
                <article key={proveedor.id} className="supplier-card">
                  <div className="supplier-card-header">
                    <div className="supplier-card-heading">
                      <h3>{proveedor.nombreComercial}</h3>
                      <p>{proveedor.codigo || "Sin código"}</p>
                    </div>
                    <span className="supplier-card-rating" title={`${proveedor.estrellas || 0} de 5`}>
                      {renderEstrellasProveedor(proveedor.estrellas)}
                    </span>
                  </div>

                  <div className="supplier-card-body">
                    <p><strong>Contacto:</strong> {obtenerContactoPrincipalProveedor(proveedor)}</p>
                    {telefonoWhatsApp ? <p><strong>Teléfono:</strong> {telefonoWhatsApp}</p> : null}
                  </div>

                  <div className="supplier-card-tags">
                    {proveedor.tipo ? <span className="supplier-card-tag type">{proveedor.tipo}</span> : null}
                    {metodosPagoLabels.map((metodo) => (
                      <span key={`${proveedor.id}-${metodo}`} className="supplier-card-tag payment">{metodo}</span>
                    ))}
                    {diasEntregaLabels.map((dia) => (
                      <span key={`${proveedor.id}-${dia}`} className="supplier-card-tag delivery">{dia}</span>
                    ))}
                  </div>

                  <div className="supplier-card-footer">
                    <button
                      type="button"
                      className="erp-btn erp-btn--secondary"
                      onClick={() => setSeleccionadoPrincipalId(proveedor.id)}
                    >
                      Ver proveedor
                    </button>
                    <button
                      type="button"
                      className="erp-btn erp-btn--primary"
                      onClick={() => editarProveedor(proveedor)}
                    >
                      Editar
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {proveedorSeleccionadoPrincipal && (
          <div className="suppliers-detail-stack">
            <div className="suppliers-detail-panel">
              <h3>Detalles de {proveedorSeleccionadoPrincipal.nombreComercial}</h3>
              {renderPerfilBasico(proveedorSeleccionadoPrincipal)}
              <p><strong>Tiempo entrega:</strong> {proveedorSeleccionadoPrincipal.tiempoEntrega || "No definido"}</p>
              <p>
                <strong>Métodos de pago:</strong>{" "}
                {Object.entries(proveedorSeleccionadoPrincipal.metodosPago || {})
                  .filter(([, enabled]) => enabled)
                  .map(([metodo]) => metodo)
                  .join(", ") || "No definido"}
              </p>
            </div>

            <div className="suppliers-detail-panel">
              <h4>Productos que vende</h4>
              {productosProveedorSeleccionado.length === 0 ? (
                <p>Este proveedor no tiene productos asignados en inventario.</p>
              ) : (
                productosProveedorSeleccionado.map((ingrediente) => (
                  <div key={ingrediente.id} className="suppliers-detail-item">
                    <p>{ingrediente.nombre} ({ingrediente.codigo})</p>
                    <p>Precio unitario: Q{ingrediente.costoUnitario}</p>
                  </div>
                ))
              )}
            </div>

            <div className="suppliers-detail-panel">
              <h4>Proveedores similares</h4>
              {proveedoresSimilares.length === 0 ? (
                <p>No se encontraron proveedores con productos similares.</p>
              ) : (
                proveedoresSimilares.map(({ proveedor, coincidencias }) => (
                  <div key={proveedor.id} className="suppliers-detail-item">
                    <p><strong>{proveedor.nombreComercial}</strong> - {proveedor.estrellas} estrellas</p>
                    <p>Productos en común:</p>
                    {coincidencias.map((ingrediente) => (
                      <p key={ingrediente.id}>• {ingrediente.nombre} — Q{ingrediente.costoUnitario}</p>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="suppliers-detail-panel">
              <h4>Historial de compras</h4>
              {obtenerUltimasComprasProveedor(proveedorSeleccionadoPrincipal).length === 0 ? (
                <p>No hay compras registradas aún.</p>
              ) : (
                obtenerUltimasComprasProveedor(proveedorSeleccionadoPrincipal).map((compra) => (
                  <div key={compra.id} className="suppliers-detail-item">
                    <p><strong>{compra.numeroOrden}</strong> — {compra.fecha}</p>
                    <p>Total: Q{compra.total.toFixed(2)}</p>
                    <p>Estado: {compra.estado}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
