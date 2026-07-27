/** Pure provision payload rules for OS1 operational stations (no Supabase). */

export const OPERATIONAL_STATION_TYPE_CASH = "cash"
export const OPERATIONAL_STATION_TYPES_REQUIRING_AREA = new Set(["kds", "production"])

export function applyStationTypeToProvisionForm(prev, stationType) {
  const next = { ...prev, stationType }
  if (stationType === OPERATIONAL_STATION_TYPE_CASH) {
    next.areaId = ""
    return next
  }
  if (OPERATIONAL_STATION_TYPES_REQUIRING_AREA.has(stationType)) {
    next.cashRegisterId = ""
    return next
  }
  next.areaId = ""
  next.cashRegisterId = ""
  return next
}

export function buildProvisionOperationalStationPayload(form) {
  const stationType = form.stationType
  const payload = {
    stationCode: form.stationCode,
    name: form.name,
    stationType,
    posFloorZone: form.posFloorZone || null
  }
  if (stationType === OPERATIONAL_STATION_TYPE_CASH) {
    return {
      ...payload,
      areaId: null,
      cashRegisterId: form.cashRegisterId || null
    }
  }
  if (OPERATIONAL_STATION_TYPES_REQUIRING_AREA.has(stationType)) {
    return {
      ...payload,
      areaId: form.areaId || null,
      cashRegisterId: null
    }
  }
  return {
    ...payload,
    areaId: null,
    cashRegisterId: null
  }
}

export function validateProvisionOperationalStationForm(form) {
  const stationType = form.stationType
  if (stationType === OPERATIONAL_STATION_TYPE_CASH) {
    if (!form.cashRegisterId) {
      return "Selecciona la caja asociada para una estación tipo Caja."
    }
    return null
  }
  if (OPERATIONAL_STATION_TYPES_REQUIRING_AREA.has(stationType)) {
    if (!form.areaId) {
      return "Selecciona un área para KDS o Producción."
    }
    return null
  }
  return null
}

export function mapOperationalStationProvisionError(message) {
  const raw = String(message || "")
  if (/operational_stations_cash_register_chk/i.test(raw)) {
    return "Las estaciones tipo Caja deben tener una caja del catálogo asociada."
  }
  if (/operational_stations_kds_area_chk/i.test(raw)) {
    return "KDS y Producción requieren un área operativa del catálogo."
  }
  return raw
}
