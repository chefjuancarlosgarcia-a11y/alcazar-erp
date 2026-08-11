import type { FelErrorClassification } from "./types.ts"

export const GENERIC_INTERNAL_ERROR = "Error interno. Intente de nuevo."

export interface ResolvedPublicRpcError {
  code: string
  message: string
  httpStatus: number
  classification: FelErrorClassification
  isKnown: boolean
}

const KNOWN_FEL_RPC_CODES = new Set([
  "FEL_INVALID_INPUT",
  "FEL_UNAUTHORIZED",
  "FEL_DOCUMENT_NOT_FOUND",
  "FEL_PRODUCTION_BLOCKED",
  "FEL_ALREADY_PROCESSING",
  "FEL_ALREADY_CERTIFIED",
  "FEL_DOCUMENT_NOT_CERTIFIABLE",
  "FEL_ORDER_NOT_PAID",
  "FEL_BALANCE_DUE",
  "FEL_PAYMENT_MISMATCH",
  "FEL_CLAIM_RACE",
  "FEL_CLAIM_FAILED",
  "FEL_EMISSION_DISABLED",
  "FEL_ENVIRONMENT_NOT_STAGE",
  "FEL_CONTINGENCY_NOT_SUPPORTED",
  "FEL_ATTEMPT_NOT_FOUND",
  "FEL_FINALIZE_INVALID_STATE",
  "FEL_FINALIZE_STALE",
  "FEL_FINALIZE_RACE",
  "FEL_SAFE_PAYLOAD_INVALID",
  "FEL_UNCERTAIN_OUTCOME",
])

const PUBLIC_RPC_MESSAGES: Record<string, { message: string; httpStatus: number; classification: FelErrorClassification }> = {
  FEL_INVALID_INPUT: { message: "Solicitud invalida.", httpStatus: 400, classification: "blocked" },
  FEL_UNAUTHORIZED: { message: "No autorizado para certificar.", httpStatus: 403, classification: "blocked" },
  FEL_DOCUMENT_NOT_FOUND: { message: "Documento FEL no encontrado.", httpStatus: 409, classification: "blocked" },
  FEL_PRODUCTION_BLOCKED: { message: "Certificacion de produccion bloqueada.", httpStatus: 409, classification: "blocked" },
  FEL_ALREADY_PROCESSING: { message: "Certificacion en curso.", httpStatus: 409, classification: "blocked" },
  FEL_ALREADY_CERTIFIED: { message: "Documento ya certificado.", httpStatus: 409, classification: "blocked" },
  FEL_DOCUMENT_NOT_CERTIFIABLE: { message: "Estado de documento no certificable.", httpStatus: 409, classification: "blocked" },
  FEL_ORDER_NOT_PAID: { message: "La orden debe estar completamente pagada.", httpStatus: 409, classification: "blocked" },
  FEL_BALANCE_DUE: { message: "Existe saldo pendiente en la orden.", httpStatus: 409, classification: "blocked" },
  FEL_PAYMENT_MISMATCH: { message: "Pagos no concilian con el total de la orden.", httpStatus: 409, classification: "blocked" },
  FEL_CLAIM_RACE: { message: "No fue posible iniciar la certificacion.", httpStatus: 409, classification: "blocked" },
  FEL_CLAIM_FAILED: { message: "No fue posible iniciar la certificacion.", httpStatus: 409, classification: "blocked" },
  FEL_EMISSION_DISABLED: { message: "La emision FEL esta deshabilitada.", httpStatus: 409, classification: "blocked" },
  FEL_ENVIRONMENT_NOT_STAGE: { message: "Ambiente FEL distinto de stage.", httpStatus: 409, classification: "blocked" },
  FEL_CONTINGENCY_NOT_SUPPORTED: { message: "Contingencia formal no habilitada.", httpStatus: 409, classification: "blocked" },
  FEL_ATTEMPT_NOT_FOUND: { message: "Intento FEL no encontrado.", httpStatus: 409, classification: "blocked" },
  FEL_FINALIZE_INVALID_STATE: { message: "Estado de documento invalido para finalizar.", httpStatus: 409, classification: "blocked" },
  FEL_FINALIZE_STALE: { message: "Intento FEL ya finalizado.", httpStatus: 409, classification: "blocked" },
  FEL_FINALIZE_RACE: { message: "No fue posible finalizar la certificacion.", httpStatus: 409, classification: "blocked" },
  FEL_SAFE_PAYLOAD_INVALID: { message: "Respuesta persistible invalida.", httpStatus: 409, classification: "blocked" },
  FEL_UNCERTAIN_OUTCOME: {
    message: "Certificacion incierta. Requiere reconciliacion manual con FELplex antes de reintentar.",
    httpStatus: 500,
    classification: "blocked",
  },
}

export function parseFelRpcErrorCode(message: string): string {
  const match = message.match(/FEL_[A-Z0-9_]+/)
  return match?.[0] ?? "FEL_RPC_UNKNOWN"
}

export function resolvePublicRpcError(code: string): ResolvedPublicRpcError {
  if (!KNOWN_FEL_RPC_CODES.has(code)) {
    return {
      code: "FEL_INTERNAL_ERROR",
      message: GENERIC_INTERNAL_ERROR,
      httpStatus: 500,
      classification: "blocked",
      isKnown: false,
    }
  }

  const mapped = PUBLIC_RPC_MESSAGES[code]
  return {
    code,
    message: mapped.message,
    httpStatus: mapped.httpStatus,
    classification: mapped.classification,
    isKnown: true,
  }
}
