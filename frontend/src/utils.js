export function generarId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

export function generarCodigo(longitudIngredientes) {
  const numero = longitudIngredientes + 1
  return `ING-${String(numero).padStart(4, "0")}`
}

export function generarCodigoProveedor(longitudProveedores) {
  const numero = longitudProveedores + 1
  return `PV-${String(numero).padStart(4, "0")}`
}

export function generarNumeroOrdenManual(longitudOrdenesManual) {
  const numero = longitudOrdenesManual + 1
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `OC-${String(numero).padStart(4, "0")}-${fecha}`
}

export function convertirAGramos(cantidad, unidad) {
  const valor = Number(cantidad)
  if (unidad === "g") return valor
  if (unidad === "kg") return valor * 1000
  if (unidad === "lb") return valor * 453.592
  if (unidad === "oz") return valor * 28.3495
  return 0
}

export function convertirAMililitros(cantidad, unidad) {
  const valor = Number(cantidad)
  if (unidad === "ml") return valor
  if (unidad === "l") return valor * 1000
  if (unidad === "gal") return valor * 3785.41
  return 0
}

export function calcularTotales(cantidad, bulk, unidad) {
  const cantidadNumero = Number(cantidad)
  const bulkNumero = Number(bulk)
  const totalUnidades = bulkNumero > 0 ? cantidadNumero * bulkNumero : cantidadNumero

  return {
    totalUnidades,
    totalGramos: convertirAGramos(totalUnidades, unidad),
    totalMililitros: convertirAMililitros(totalUnidades, unidad)
  }
}

export function limpiarNumero(valor) {
  const limpio = String(valor || "0")
    .replace("Q", "")
    .replace(",", ".")
    .trim()

  const numero = Number(limpio)
  return isNaN(numero) ? 0 : numero
}

export function obtenerMetodoPagoPreferido(proveedor) {
  if (!proveedor || !proveedor.metodosPago) return "banco"
  const metodos = proveedor.metodosPago
  if (metodos.transferencia) return "transferencia"
  if (metodos.tarjeta) return "tarjeta"
  if (metodos.efectivo) return "efectivo"
  return "banco"
}

export function obtenerAlerta(ingrediente) {
  const stock = Number(ingrediente.stockActual !== undefined && ingrediente.stockActual !== null
    ? ingrediente.stockActual
    : ingrediente.totalUnidades)
  const minimo = Number(ingrediente.puntoMinimo)
  const orden = Number(ingrediente.puntoOrden)
  const maximo = Number(ingrediente.puntoMaximo)

  if (minimo > 0 && stock <= minimo) return "🔴 CRÍTICO"
  if (orden > 0 && stock <= orden) return "🟡 COMPRAR"
  if (maximo > 0 && stock > maximo) return "🔵 SOBRE STOCK"
  return "🟢 OK"
}
