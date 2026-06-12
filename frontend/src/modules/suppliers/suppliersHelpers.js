export function obtenerTelefonosProveedor(proveedor) {
  const telefonos = Array.isArray(proveedor?.telefonos) ? proveedor.telefonos : []
  return [...telefonos, proveedor?.telefono, proveedor?.telefono2, proveedor?.telefono3]
    .map((telefono) => String(telefono || "").trim())
    .filter((telefono, index, lista) => telefono && lista.indexOf(telefono) === index)
}

export function formatearMetodosPagoProveedor(metodosPago) {
  const labels = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    tarjeta: "Tarjeta",
    cheque: "Cheque"
  }
  return Object.entries(metodosPago || {})
    .filter(([, enabled]) => enabled)
    .map(([metodo]) => labels[metodo] || metodo)
}

export function formatearDiasEntregaProveedor(diasEntrega) {
  return Object.entries(diasEntrega || {})
    .filter(([, enabled]) => enabled)
    .map(([dia]) => `${dia.charAt(0).toUpperCase()}${dia.slice(1, 3)}`)
}

export function renderEstrellasProveedor(estrellas) {
  const total = Math.max(0, Math.min(5, Number(estrellas) || 0))
  return `${"★".repeat(total)}${"☆".repeat(5 - total)}`
}

export function obtenerContactoPrincipalProveedor(proveedor) {
  return proveedor?.encargado || proveedor?.correo || "Sin contacto"
}

export function obtenerTelefonoWhatsAppProveedor(proveedor) {
  const telefonos = obtenerTelefonosProveedor(proveedor)
  if (proveedor?.whatsapp) return `WhatsApp: ${proveedor.whatsapp}`
  if (telefonos.length) return telefonos[0]
  return ""
}

export function normalizarUrlProveedor(url) {
  const limpia = String(url || "").trim()
  if (!limpia) return ""
  return /^https?:\/\//i.test(limpia) ? limpia : `https://${limpia}`
}

export function obtenerProveedoresSimilares(proveedor, proveedores, ingredientes) {
  const productoNombres = ingredientes
    .filter((ingrediente) => ingrediente.proveedorId === proveedor.id)
    .map((ingrediente) => ingrediente.nombre.toLowerCase())

  return proveedores
    .filter((p) => p.id !== proveedor.id)
    .map((p) => {
      const coincidencias = ingredientes.filter(
        (ingrediente) => ingrediente.proveedorId === p.id && productoNombres.includes(ingrediente.nombre.toLowerCase())
      )
      return { proveedor: p, coincidencias }
    })
    .filter((item) => item.coincidencias.length > 0)
}

export function obtenerUltimasComprasProveedor(proveedor) {
  return (proveedor.historialCompras || []).slice(0, 2)
}

export function filtrarProveedoresLista(proveedores, textoBusqueda) {
  const texto = textoBusqueda.trim().toLowerCase()
  if (!texto) return proveedores
  return proveedores.filter((proveedor) => {
    const telefonos = obtenerTelefonosProveedor(proveedor).join(" ").toLowerCase()
    return (
      String(proveedor.nombreComercial || "").toLowerCase().includes(texto) ||
      String(proveedor.razonSocial || "").toLowerCase().includes(texto) ||
      String(proveedor.codigo || "").toLowerCase().includes(texto) ||
      String(proveedor.tipo || "").toLowerCase().includes(texto) ||
      String(proveedor.encargado || "").toLowerCase().includes(texto) ||
      String(proveedor.correo || "").toLowerCase().includes(texto) ||
      String(proveedor.whatsapp || "").toLowerCase().includes(texto) ||
      telefonos.includes(texto)
    )
  })
}

export function filtrarProveedoresFormulario(proveedores, textoBusqueda) {
  const texto = textoBusqueda.toLowerCase()
  if (!texto) return []
  return proveedores.filter(
    (proveedor) =>
      String(proveedor.nombreComercial || "").toLowerCase().includes(texto) ||
      String(proveedor.razonSocial || "").toLowerCase().includes(texto) ||
      String(proveedor.codigo || "").toLowerCase().includes(texto)
  )
}

export const PROVEEDOR_DIAS_ENTREGA_INICIAL = {
  lunes: false,
  martes: false,
  miercoles: false,
  jueves: false,
  viernes: false,
  sabado: false,
  domingo: false
}

export const PROVEEDOR_METODOS_PAGO_INICIAL = {
  efectivo: false,
  transferencia: false,
  tarjeta: false,
  cheque: false
}

export const PROVEEDOR_TIPOS = [
  "Lácteos",
  "Carnes",
  "Vegetales",
  "Importados",
  "Bebidas",
  "Empaques",
  "Limpieza",
  "Equipo"
]

export const PROVEEDOR_TIEMPOS_ENTREGA = [
  { value: "mismo dia", label: "Mismo día" },
  { value: "1 dia", label: "1 día" },
  { value: "2 dias", label: "2 días" },
  { value: "1 semana", label: "1 semana" },
  { value: "2 semanas", label: "2 semanas" },
  { value: "mensual", label: "Mensual" }
]
