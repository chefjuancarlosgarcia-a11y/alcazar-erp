import { FELPLEX_HTTP_TIMEOUT_MS } from "./constants.ts"
import { sanitizePublicMessage } from "./sanitize.ts"
import { validateFelplexStageUrl } from "./urlAllowlist.ts"
import type { FelplexTransport, FelplexTransportRequest, FelplexTransportResult } from "./types.ts"

export function createFetchFelplexTransport(
  fetchImpl: typeof fetch = fetch,
): FelplexTransport {
  return {
    async send(request: FelplexTransportRequest): Promise<FelplexTransportResult> {
      const urlError = validateFelplexStageUrl(request.url)
      if (urlError) {
        return {
          ok: false,
          errorKind: "blocked",
          sanitizedMessage: sanitizePublicMessage(urlError.message),
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs)

      try {
        const response = await fetchImpl(request.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Authorization": request.apiKey,
          },
          body: JSON.stringify(request.body),
          signal: controller.signal,
          redirect: "error",
        })

        const redirectedError = validateFelplexStageUrl(response.url)
        if (redirectedError) {
          return {
            ok: false,
            errorKind: "blocked",
            sanitizedMessage: sanitizePublicMessage("Redireccion FELplex no autorizada."),
          }
        }

        const text = await response.text()
        let body: unknown = null

        if (response.status >= 500) {
          return {
            ok: false,
            httpStatus: response.status,
            body,
            errorKind: "http_5xx",
            sanitizedMessage: sanitizePublicMessage(`Error temporal del proveedor (${response.status}).`),
          }
        }

        if (response.status >= 400) {
          try {
            body = text ? JSON.parse(text) : null
          } catch {
            return {
              ok: false,
              httpStatus: response.status,
              errorKind: "malformed",
              sanitizedMessage: sanitizePublicMessage(`Respuesta invalida (${response.status}).`),
            }
          }
          return {
            ok: false,
            httpStatus: response.status,
            body,
            errorKind: "http_4xx",
            sanitizedMessage: sanitizePublicMessage(`Solicitud rechazada (${response.status}).`),
          }
        }

        try {
          body = text ? JSON.parse(text) : null
        } catch {
          return {
            ok: false,
            httpStatus: response.status,
            errorKind: "malformed",
            sanitizedMessage: sanitizePublicMessage(`Respuesta invalida (${response.status}).`),
          }
        }

        return {
          ok: true,
          httpStatus: response.status,
          body,
          sanitizedMessage: "Certificacion recibida.",
        }
      } catch (error) {
        if (error instanceof TypeError && String(error.message).toLowerCase().includes("redirect")) {
          return {
            ok: false,
            errorKind: "blocked",
            sanitizedMessage: sanitizePublicMessage("Redireccion FELplex no autorizada."),
          }
        }

        const aborted = error instanceof DOMException && error.name === "AbortError"
        return {
          ok: false,
          errorKind: aborted ? "timeout" : "network",
          sanitizedMessage: sanitizePublicMessage(
            aborted ? "Tiempo de espera agotado." : "Error de red al contactar FELplex.",
          ),
        }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export { buildFelplexCertifyUrlFromAllowlist as buildFelplexCertifyUrl } from "./urlAllowlist.ts"

export function defaultTransportRequest(
  url: string,
  apiKey: string,
  body: unknown,
): FelplexTransportRequest {
  const urlError = validateFelplexStageUrl(url)
  if (urlError) {
    throw new Error(urlError.message)
  }

  return {
    url,
    apiKey,
    body,
    timeoutMs: FELPLEX_HTTP_TIMEOUT_MS,
  }
}

export function safeTransportLog(url: string): string {
  const parsed = validateFelplexStageUrl(url)
  if (parsed) return "[blocked-url]"
  try {
    return new URL(url).origin + new URL(url).pathname
  } catch {
    return "[redacted-url]"
  }
}
