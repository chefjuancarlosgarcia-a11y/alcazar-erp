export class BillingError extends Error {
  code: string
  retryable: boolean
  httpStatus?: number

  constructor(message: string, code = "BILLING_ERROR", retryable = false, httpStatus?: number) {
    super(message)
    this.name = "BillingError"
    this.code = code
    this.retryable = retryable
    this.httpStatus = httpStatus
  }
}

export function classifyHttpError(status: number): BillingError {
  if (status === 401 || status === 403) {
    return new BillingError("Error de autenticacion con el certificador.", "BILLING_AUTH", false, status)
  }
  if (status >= 500) {
    return new BillingError("El certificador no respondio correctamente.", "BILLING_UPSTREAM", true, status)
  }
  return new BillingError("Error de comunicacion con el certificador.", "BILLING_HTTP", false, status)
}
