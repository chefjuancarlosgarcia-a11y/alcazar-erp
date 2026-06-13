export function getAttendanceMarkLabel(type) {
  return {
    entrada: "Entrada",
    salida: "Salida",
    salida_comida: "Salida a comida",
    regreso_comida: "Regreso de comida",
    salida_final: "Salida final",
    bano_inicio: "Baño / Break",
    bano_regreso: "Regreso de baño"
  }[type] || type
}

export function getLateArrivalStatusLabel(row) {
  return row.sinSalida ? "Sin salida" : "En turno cerrado"
}

export function getLateArrivalBadgeClass(row) {
  return row.sinSalida
    ? "erp-badge erp-badge--warning attendance-reports-badge"
    : "erp-badge erp-badge--success attendance-reports-badge"
}

export function getMovementTypeBadgeClass(tipo) {
  if (tipo === "entrada") return "erp-badge erp-badge--success attendance-reports-badge"
  if (tipo === "salida" || tipo === "salida_final") return "erp-badge erp-badge--info attendance-reports-badge"
  if (tipo === "bano_inicio" || tipo === "bano_regreso") return "erp-badge erp-badge--warning attendance-reports-badge"
  return "erp-badge attendance-reports-badge"
}

export function formatHorasTrabajadas(totalMinutos) {
  return `${(totalMinutos / 60).toFixed(2)} h`
}

export function buildAttendanceReportsKpis({
  entradasDelDia = [],
  salidasDelDia = [],
  llegadasTarde = [],
  asistenciaGraceMinutes = 0,
  salidasTempranas = [],
  faltasDelDia = [],
  horasTrabajadas = [],
  banosDelDia = [],
  regresosBanoDelDia = [],
  colaboradoresDentroTurno = [],
  colaboradoresSinSalida = [],
  resumenSemanal = [],
  resumenMensual = []
}) {
  const excesosBano = (regresosBanoDelDia || []).filter((movimiento) => movimiento.excedido).length

  return [
    {
      id: "daily",
      title: "Asistencia diaria",
      value: `${entradasDelDia.length} entradas · ${salidasDelDia.length} salidas`,
      note: null
    },
    {
      id: "late",
      title: "Llegadas tarde",
      value: `${llegadasTarde.length} registros`,
      note: asistenciaGraceMinutes > 0 ? `Tolerancia: ${asistenciaGraceMinutes} min` : null,
      tone: llegadasTarde.length > 0 ? "warning" : null
    },
    {
      id: "early-exit",
      title: "Salidas tempranas",
      value: `${salidasTempranas.length} registros`,
      tone: salidasTempranas.length > 0 ? "warning" : null
    },
    {
      id: "absences",
      title: "Faltas",
      value: `${faltasDelDia.length} colaboradores sin entrada`,
      tone: faltasDelDia.length > 0 ? "danger" : null
    },
    {
      id: "hours",
      title: "Horas trabajadas",
      value: horasTrabajadas.length ? `${horasTrabajadas.length} colaboradores` : "Sin horas cerradas",
      detail: horasTrabajadas
    },
    {
      id: "bathroom",
      title: "Uso de baño por colaborador",
      value: `${banosDelDia.length} usos registrados`,
      note: null
    },
    {
      id: "bathroom-excess",
      title: "Excesos de baño",
      value: `${excesosBano} excesos`,
      tone: excesosBano > 0 ? "warning" : null
    },
    {
      id: "in-shift",
      title: "Actualmente dentro del turno",
      value: `${colaboradoresDentroTurno.length} colaboradores`,
      tone: colaboradoresDentroTurno.length > 0 ? "success" : null
    },
    {
      id: "no-checkout",
      title: "Sin marcar salida",
      value: `${colaboradoresSinSalida.length} colaboradores`,
      tone: colaboradoresSinSalida.length > 0 ? "warning" : null
    },
    {
      id: "weekly",
      title: "Resumen semanal",
      value: `${resumenSemanal.length} movimientos en 7 días`,
      note: null
    },
    {
      id: "monthly",
      title: "Resumen mensual",
      value: `${resumenMensual.length} movimientos del mes`,
      note: null
    }
  ]
}

export function getKpiToneClass(tone) {
  if (tone === "success") return "attendance-reports-kpi--success"
  if (tone === "warning") return "attendance-reports-kpi--warning"
  if (tone === "danger") return "attendance-reports-kpi--danger"
  return ""
}

export function getLocalDateString(fecha = new Date()) {
  const fechaLocal = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000)
  return fechaLocal.toISOString().slice(0, 10)
}

function obtenerMinutosDesdeHora(hora) {
  if (!hora) return null
  const [horas, minutos] = String(hora).split(":").map(Number)
  if (Number.isNaN(horas) || Number.isNaN(minutos)) return null
  return horas * 60 + minutos
}

function obtenerHora24DesdeTurno(turno, tipo = "start") {
  if (!turno) return ""
  const valorDirecto = tipo === "start" ? turno.entrada : turno.salida
  if (valorDirecto) return valorDirecto

  const time = tipo === "start" ? turno.startTime : turno.endTime
  const period = tipo === "start" ? turno.startPeriod : turno.endPeriod
  if (!time) return ""

  const [horaTexto, minutoTexto = "00"] = String(time).split(":")
  let hora = Number(horaTexto)
  const minuto = String(minutoTexto).padStart(2, "0")
  if (Number.isNaN(hora)) return ""
  if (period === "PM" && hora < 12) hora += 12
  if (period === "AM" && hora === 12) hora = 0
  return `${String(hora).padStart(2, "0")}:${minuto}`
}

function obtenerTurnosColaborador(colaborador) {
  if (!colaborador) return []
  if (Array.isArray(colaborador.schedules) && colaborador.schedules.length > 0) return colaborador.schedules
  if (Array.isArray(colaborador.turnos) && colaborador.turnos.length > 0) return colaborador.turnos
  if (colaborador.horario) return [colaborador.horario]
  if (colaborador.horarios) return Array.isArray(colaborador.horarios) ? colaborador.horarios : [colaborador.horarios]
  return []
}

function calcularMinutosEntre(inicioISO, finISO) {
  const inicio = new Date(inicioISO).getTime()
  const fin = new Date(finISO).getTime()
  if (Number.isNaN(inicio) || Number.isNaN(fin)) return 0
  return Math.max(0, Math.round((fin - inicio) / 60000))
}

function getUltimoMovimientoEntradaSalida(colaboradorId, asistenciaMovimientos, fechaHoy) {
  return asistenciaMovimientos
    .filter((movimiento) => movimiento.colaboradorId === colaboradorId && movimiento.fecha === fechaHoy)
    .sort((a, b) => new Date(b.fechaHoraISO || 0) - new Date(a.fechaHoraISO || 0))
    .find((movimiento) => ["entrada", "salida"].includes(movimiento.tipo))
}

export function normalizeLateArrivalRow(row, index = 0) {
  const baseId = row?.id
    || `${row?.colaboradorId || "emp"}-${row?.fecha || "fecha"}-${row?.horaProgramada || "hora"}-${row?.horaEntrada || "in"}`
  return { ...row, id: `${baseId}-${index}` }
}

export function computeAttendanceReportMetrics({
  asistenciaMovimientos = [],
  asistenciaPerfiles = [],
  asistenciaLlegadasTarde = [],
  asistenciaFechaFiltro = "",
  asistenciaReporteColaboradorId = "",
  asistenciaBusqueda = "",
  fechaHoy = getLocalDateString()
}) {
  const textoBusqueda = String(asistenciaBusqueda || "").toLowerCase()

  const movimientosFechaFiltro = asistenciaMovimientos.filter(
    (movimiento) => movimiento?.fecha === asistenciaFechaFiltro
  )
  const movimientosReportesBase = asistenciaReporteColaboradorId
    ? movimientosFechaFiltro.filter(
      (movimiento) => String(movimiento.colaboradorId) === String(asistenciaReporteColaboradorId)
    )
    : movimientosFechaFiltro
  const movimientosReportes = movimientosReportesBase.filter((movimiento) => (
    !textoBusqueda
    || String(movimiento.colaboradorNombre || "").toLowerCase().includes(textoBusqueda)
    || String(movimiento.colaboradorUsername || "").toLowerCase().includes(textoBusqueda)
  ))

  const colaboradoresDentroTurno = asistenciaPerfiles.filter(
    (usuario) => getUltimoMovimientoEntradaSalida(usuario.id, asistenciaMovimientos, fechaHoy)?.tipo === "entrada"
  )
  const colaboradoresSinSalida = colaboradoresDentroTurno
  const entradasDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "entrada")
  const salidasDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "salida")
  const banosDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "bano_inicio")
  const regresosBanoDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "bano_regreso")
  const llegadasTarde = asistenciaLlegadasTarde
    .filter((row) => (
      !textoBusqueda
      || String(row.colaboradorNombre || "").toLowerCase().includes(textoBusqueda)
      || String(row.area || "").toLowerCase().includes(textoBusqueda)
    ))
    .map(normalizeLateArrivalRow)

  const salidasTempranas = salidasDelDia.filter((movimiento) => {
    const colaborador = asistenciaPerfiles.find((usuario) => usuario.id === movimiento.colaboradorId)
    const salidaTurno = obtenerMinutosDesdeHora(obtenerHora24DesdeTurno(obtenerTurnosColaborador(colaborador)[0], "end"))
    const salidaReal = obtenerMinutosDesdeHora(movimiento.hora)
    return salidaTurno !== null && salidaReal !== null && salidaReal < salidaTurno
  })

  const faltasDelDia = asistenciaPerfiles.filter((usuario) =>
    usuario.activo !== false
    && !entradasDelDia.some((movimiento) => movimiento.colaboradorId === usuario.id)
  )

  const horasTrabajadas = asistenciaPerfiles.map((usuario) => {
    const movimientosUsuario = movimientosFechaFiltro
      .filter((movimiento) => movimiento.colaboradorId === usuario.id && ["entrada", "salida"].includes(movimiento.tipo))
      .sort((a, b) => new Date(a.fechaHoraISO || 0) - new Date(b.fechaHoraISO || 0))
    let totalMinutos = 0
    let entradaAbierta = null
    movimientosUsuario.forEach((movimiento) => {
      if (movimiento.tipo === "entrada") entradaAbierta = movimiento
      if (movimiento.tipo === "salida" && entradaAbierta) {
        totalMinutos += calcularMinutosEntre(entradaAbierta.fechaHoraISO, movimiento.fechaHoraISO)
        entradaAbierta = null
      }
    })
    return { usuario, totalMinutos }
  }).filter((item) => item.totalMinutos > 0)

  const resumenSemanal = asistenciaMovimientos.filter((movimiento) => {
    if (!movimiento?.fecha || !asistenciaFechaFiltro) return false
    const fechaMovimiento = new Date(`${movimiento.fecha}T00:00:00`)
    const fechaFiltro = new Date(`${asistenciaFechaFiltro}T00:00:00`)
    if (Number.isNaN(fechaMovimiento.getTime()) || Number.isNaN(fechaFiltro.getTime())) return false
    const diferenciaDias = Math.floor((fechaFiltro - fechaMovimiento) / 86400000)
    return diferenciaDias >= 0 && diferenciaDias < 7
  })

  const resumenMensual = asistenciaMovimientos.filter((movimiento) =>
    String(movimiento?.fecha || "").slice(0, 7) === String(asistenciaFechaFiltro || "").slice(0, 7)
  )

  return {
    movimientosReportes,
    colaboradoresDentroTurno,
    colaboradoresSinSalida,
    entradasDelDia,
    salidasDelDia,
    banosDelDia,
    regresosBanoDelDia,
    llegadasTarde,
    salidasTempranas,
    faltasDelDia,
    horasTrabajadas,
    resumenSemanal,
    resumenMensual
  }
}
