import { supabase } from "../lib/supabase"
import {
  buildProvisionOperationalStationPayload,
  mapOperationalStationProvisionError
} from "./operationalStationsProvisionHelpers.js"

export {
  applyStationTypeToProvisionForm,
  buildProvisionOperationalStationPayload,
  mapOperationalStationProvisionError,
  validateProvisionOperationalStationForm
} from "./operationalStationsProvisionHelpers.js"

const ENROLL_FUNCTION = "operational-station-enroll"
export const CLAIM_SECRET_STORAGE_PREFIX = "os1-device-claim-secret:"

function newIdempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function claimSecretStorageKey(enrollmentId, deviceId) {
  return `${CLAIM_SECRET_STORAGE_PREFIX}${enrollmentId}:${deviceId}`
}

export function saveDeviceClaimSecret(enrollmentId, deviceId, secret) {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.setItem(claimSecretStorageKey(enrollmentId, deviceId), secret)
}

export function loadDeviceClaimSecret(enrollmentId, deviceId) {
  if (typeof sessionStorage === "undefined") return ""
  return sessionStorage.getItem(claimSecretStorageKey(enrollmentId, deviceId)) || ""
}

export function clearDeviceClaimSecret(enrollmentId, deviceId) {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.removeItem(claimSecretStorageKey(enrollmentId, deviceId))
}

export async function getOperationalStationsEnabled() {
  const { data, error } = await supabase.rpc("operational_stations_enabled")
  if (error) return { enabled: false, error }
  return { enabled: Boolean(data), error: null }
}

export async function listOperationalStations() {
  return supabase.rpc("list_operational_stations_admin")
}

export async function listOperationalStationDevices(stationId, status) {
  return supabase.rpc("list_operational_station_devices_admin", {
    p_station_id: stationId || null,
    p_status: status || null
  })
}

export async function provisionOperationalStation(payload) {
  const built = buildProvisionOperationalStationPayload(payload)
  const result = await supabase.rpc("provision_operational_station", {
    p_station_code: built.stationCode,
    p_name: built.name,
    p_station_type: built.stationType,
    p_area_id: built.areaId || null,
    p_cash_register_id: built.cashRegisterId || null,
    p_pos_floor_zone: built.posFloorZone || null
  })
  if (result.error?.message) {
    return {
      ...result,
      error: {
        ...result.error,
        message: mapOperationalStationProvisionError(result.error.message)
      }
    }
  }
  return result
}

export async function updateOperationalStation(stationId, payload) {
  return supabase.rpc("update_operational_station", {
    p_station_id: stationId,
    p_name: payload.name || null,
    p_status: payload.status || null,
    p_area_id: payload.areaId || null,
    p_pos_floor_zone: payload.posFloorZone || null
  })
}

export async function createStationEnrollmentToken(stationId, idempotencyKey) {
  return supabase.rpc("create_station_enrollment_token", {
    p_station_id: stationId,
    p_idempotency_key: idempotencyKey || null
  })
}

export async function rejectAndBlockStationDevice(deviceId, reason) {
  return supabase.rpc("reject_and_block_station_device", {
    p_device_id: deviceId,
    p_reason: reason || null
  })
}

export async function revokeStationDevice(deviceId, reason) {
  return supabase.rpc("revoke_station_device", {
    p_device_id: deviceId,
    p_reason: reason || null
  })
}

export async function replaceStationDevice(deviceId, reason) {
  return supabase.rpc("replace_station_device", {
    p_device_id: deviceId,
    p_reason: reason || null
  })
}

async function invokeEnroll(body, idempotencyKey) {
  const key = idempotencyKey || newIdempotencyKey("enroll")
  return supabase.functions.invoke(ENROLL_FUNCTION, {
    body,
    headers: { "x-idempotency-key": key }
  })
}

export async function claimStationEnrollment({ token, fingerprint, userAgent, idempotencyKey }) {
  return invokeEnroll(
    {
      action: "claim",
      token,
      client_fingerprint: fingerprint,
      user_agent: userAgent || ""
    },
    idempotencyKey || newIdempotencyKey("claim")
  )
}

export async function pollStationEnrollmentStatus({
  deviceId,
  enrollmentId,
  deviceClaimSecret,
  idempotencyKey
}) {
  return invokeEnroll(
    {
      action: "status",
      device_id: deviceId,
      enrollment_id: enrollmentId,
      device_claim_secret: deviceClaimSecret
    },
    idempotencyKey || newIdempotencyKey("status")
  )
}

export async function authorizeStationDevice({
  deviceId,
  confirmationCode,
  deviceLabel,
  reason,
  idempotencyKey
}) {
  return invokeEnroll(
    {
      action: "authorize",
      device_id: deviceId,
      confirmation_code: confirmationCode,
      device_label: deviceLabel || "Terminal operativa",
      reason: reason || ""
    },
    idempotencyKey || newIdempotencyKey("authorize")
  )
}

export async function completeStationEnrollment({
  enrollmentId,
  deviceId,
  deviceClaimSecret,
  idempotencyKey
}) {
  return invokeEnroll(
    {
      action: "complete",
      enrollment_id: enrollmentId,
      device_id: deviceId,
      device_claim_secret: deviceClaimSecret
    },
    idempotencyKey || newIdempotencyKey("complete")
  )
}

export async function getOperationalStationDeviceContext() {
  return supabase.rpc("get_operational_station_device_context")
}

export function buildEnrollmentUrl(token) {
  const base = typeof window !== "undefined" ? window.location.origin : ""
  return `${base}/station-enroll#token=${encodeURIComponent(token)}`
}
