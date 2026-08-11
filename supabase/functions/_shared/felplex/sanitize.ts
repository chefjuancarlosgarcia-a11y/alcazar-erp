const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /x-authorization/i,
  /bearer\s+/i,
  /service_role/i,
  /secret/i,
  /password/i,
  /token/i,
]

export function sanitizePublicMessage(input: unknown, fallback = "No fue posible certificar el documento."): string {
  const message = String(input ?? "").trim()
  if (!message) return fallback
  if (SECRET_PATTERNS.some((pattern) => pattern.test(message))) return fallback
  if (message.length > 240) return `${message.slice(0, 237)}...`
  return message
}

export function sanitizeFelplexErrors(errors: unknown): string {
  if (errors == null) return "Certificacion rechazada."
  if (Array.isArray(errors)) {
    return sanitizePublicMessage(errors.map((entry) => String(entry)).join("; "))
  }
  if (typeof errors === "string") {
    return sanitizePublicMessage(errors)
  }
  if (typeof errors === "object") {
    const record = errors as Record<string, unknown>
    const safeParts: string[] = []
    for (const key of ["code", "message", "detail"]) {
      if (typeof record[key] === "string") {
        safeParts.push(String(record[key]))
      }
    }
    if (safeParts.length > 0) {
      return sanitizePublicMessage(safeParts.join("; "))
    }
    return sanitizePublicMessage("Certificacion rechazada.")
  }
  return sanitizePublicMessage(String(errors))
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return "[redacted-url]"
  }
}
