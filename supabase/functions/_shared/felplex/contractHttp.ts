import { FELPLEX_CONTRACT_HTTP_CONFIRMED_ENV } from "./constants.ts"
import type { GateFailure } from "./types.ts"

/** Fail-closed until Stage HTTP proof with real empresa/api_key. */
export function isFelplexContractHttpConfirmed(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): boolean {
  const raw = env.get(FELPLEX_CONTRACT_HTTP_CONFIRMED_ENV)
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes"
}

export function felplexContractHttpBlockedFailure(): GateFailure {
  return {
    code: "FELPLEX_CONTRACT_UNCONFIRMED",
    message: "Contrato FELplex Guatemala adoptado de forma provisional; HTTP bloqueado hasta confirmacion Stage.",
    classification: "blocked",
  }
}
