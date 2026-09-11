import { DIMENSION_RULES } from "./financeAccountingFoundationConstants.js"
import {
  centsToDecimalNumber,
  formatAmountPayload,
  parseAmountToCents,
  sumLineAmountCents
} from "./financeJournalAmounts.js"

export function roundMoney(value) {
  const parsed = parseAmountToCents(String(value ?? ""))
  if (!parsed.ok) return 0
  return centsToDecimalNumber(parsed.cents)
}

export function parseAmount(value) {
  const parsed = parseAmountToCents(value)
  if (!parsed.ok) return NaN
  return centsToDecimalNumber(parsed.cents)
}

export function lineTotals(lines) {
  const debitCents = sumLineAmountCents(lines, "debit")
  const creditCents = sumLineAmountCents(lines, "credit")
  return {
    debit: centsToDecimalNumber(debitCents),
    credit: centsToDecimalNumber(creditCents),
    debitCents,
    creditCents,
    balanced: debitCents === creditCents
  }
}

export function validateLineAmount(value) {
  const parsed = parseAmountToCents(value)
  if (!parsed.ok) return parsed
  return { ok: true, message: "" }
}

export function validateLineXor(line) {
  const debitParsed = parseAmountToCents(line.debit)
  const creditParsed = parseAmountToCents(line.credit)
  if (!debitParsed.ok) return { valid: false, message: debitParsed.message }
  if (!creditParsed.ok) return { valid: false, message: creditParsed.message }

  const hasDebit = debitParsed.cents > 0n
  const hasCredit = creditParsed.cents > 0n
  if (hasDebit && hasCredit) return { valid: false, message: "Una línea no puede tener débito y crédito." }
  if (!hasDebit && !hasCredit) return { valid: false, message: "Indique débito o crédito mayor a cero." }
  return { valid: true, message: "" }
}

export function validateMinLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { valid: false, message: "La partida requiere al menos dos líneas." }
  }
  return { valid: true, message: "" }
}

export function validateBalance(lines) {
  const { debitCents, creditCents, debit, credit } = lineTotals(lines)
  if (debitCents !== creditCents) {
    return {
      valid: false,
      message: `La partida no cuadra (débitos ${debit.toFixed(2)} ≠ créditos ${credit.toFixed(2)}).`
    }
  }
  return { valid: true, message: "" }
}

export function validateLineAccount(line) {
  if (!line.account_id) {
    return { valid: false, message: "Seleccione una cuenta contable en cada línea." }
  }
  return { valid: true, message: "" }
}

export function validateLineDimensions(account, line) {
  if (!account) {
    return { valid: false, message: "Cuenta contable no encontrada." }
  }
  const branchRule = account.branch_dimension_rule || "optional"
  const ccRule = account.cost_center_dimension_rule || "optional"
  const branchId = line.branch_id || ""
  const costCenterId = line.cost_center_id || ""

  if (branchRule === "required" && !branchId) {
    return { valid: false, message: `La cuenta ${account.code} requiere sucursal.` }
  }
  if (branchRule === "prohibited" && branchId) {
    return { valid: false, message: `La cuenta ${account.code} no permite sucursal.` }
  }
  if (ccRule === "required" && !costCenterId) {
    return { valid: false, message: `La cuenta ${account.code} requiere centro de costo.` }
  }
  if (ccRule === "prohibited" && costCenterId) {
    return { valid: false, message: `La cuenta ${account.code} no permite centro de costo.` }
  }
  return { valid: true, message: "" }
}

export function validateJournalForm(form, accountsById) {
  const description = String(form.description ?? "").trim()
  if (!description) {
    return { valid: false, message: "La descripción es obligatoria." }
  }
  if (!form.entry_date) {
    return { valid: false, message: "La fecha contable es obligatoria." }
  }
  const minLines = validateMinLines(form.lines)
  if (!minLines.valid) return minLines

  for (const line of form.lines) {
    const account = accountsById.get(line.account_id)
    const accountCheck = validateLineAccount(line)
    if (!accountCheck.valid) return accountCheck
    const xor = validateLineXor(line)
    if (!xor.valid) return xor
    const dims = validateLineDimensions(account, line)
    if (!dims.valid) return dims
  }

  const balance = validateBalance(form.lines)
  if (!balance.valid) return balance
  return { valid: true, message: "" }
}

/** Indica si el formulario cumple todas las reglas para habilitar «Enviar a aprobación». */
export function canSubmitJournalForm(form, accountsById) {
  return validateJournalForm(form, accountsById).valid
}

export function filterPostableAccounts(accounts) {
  return accounts.filter(
    (row) => row.is_active && row.account_kind === "detail" && row.accepts_entries
  )
}

export function filterCostCentersForBranch(costCenters, branchId) {
  const normalizedBranch = branchId || ""
  return costCenters.filter((cc) => {
    if (!cc.is_active || cc.account_kind !== "detail") return false
    if (!cc.branch_id) return true
    return normalizedBranch && cc.branch_id === normalizedBranch
  })
}

export function normalizeDimensionValue(rule, value) {
  if (rule === "prohibited") return null
  const text = value == null ? "" : String(value).trim()
  return text || null
}

export function buildRpcLinesPayload(lines, accountsById) {
  return lines.map((line, index) => {
    const account = accountsById.get(line.account_id) || {}
    const branchRule = account.branch_dimension_rule || "optional"
    const ccRule = account.cost_center_dimension_rule || "optional"
    const debitPayload = formatAmountPayload(line.debit) || "0.00"
    const creditPayload = formatAmountPayload(line.credit) || "0.00"
    return {
      line_number: index + 1,
      account_id: line.account_id,
      branch_id: normalizeDimensionValue(branchRule, line.branch_id),
      cost_center_id: normalizeDimensionValue(ccRule, line.cost_center_id),
      description: String(line.description ?? "").trim(),
      reference: String(line.reference ?? "").trim(),
      debit: debitPayload,
      credit: creditPayload
    }
  })
}

export function buildDraftPayload(form) {
  return {
    entry_date: form.entry_date,
    description: String(form.description ?? "").trim(),
    reference: String(form.reference ?? "").trim(),
    currency: "GTQ"
  }
}

export function journalActionsForRole(status, permissions) {
  const actions = []
  if (!permissions.canView) return actions
  if (status === "draft" && permissions.canCreate) {
    actions.push("save_draft", "submit")
  }
  if (status === "pending_approval" && permissions.canApprove) {
    actions.push("approve", "reject")
  }
  if (status === "approved" && permissions.canPost) {
    actions.push("post")
  }
  if (status === "posted" && permissions.canReverse) {
    actions.push("reverse")
  }
  return actions
}

export function canPerformJournalAction(status, action, permissions) {
  return journalActionsForRole(status, permissions).includes(action)
}

export function normalizeBackendError(errorText) {
  const text = String(errorText || "").trim()
  if (!text) return "No se pudo completar la operación."
  if (/permission denied|permiso/i.test(text)) return text
  if (/does not exist|schema cache|Could not find/i.test(text)) {
    return "El motor contable no está disponible. Contacte al administrador."
  }
  if (/JWT|auth|session/i.test(text)) return "Su sesión expiró. Vuelva a iniciar sesión."
  return text.replace(/\s+/g, " ").slice(0, 280)
}

function normalizeRpcAmount(value) {
  if (value == null || value === "") return 0
  const parsed = parseAmountToCents(String(value))
  if (!parsed.ok) return Number(value) || 0
  return centsToDecimalNumber(parsed.cents)
}

function normalizeRpcLine(line) {
  if (!line || typeof line !== "object") return line
  return {
    ...line,
    debit: normalizeRpcAmount(line.debit),
    credit: normalizeRpcAmount(line.credit)
  }
}

export function entryFromRpc(row) {
  if (!row || typeof row !== "object") return null
  return {
    ...row,
    lines: Array.isArray(row.lines) ? row.lines.map(normalizeRpcLine) : []
  }
}

export function entriesFromRpcList(data) {
  if (Array.isArray(data)) {
    return data.map(entryFromRpc).filter(Boolean)
  }
  return []
}

export function formFromEntry(entry) {
  return {
    entry_date: entry.entry_date || "",
    description: entry.description || "",
    reference: entry.reference || "",
    lines: (entry.lines || []).map((line, index) => ({
      key: line.id || `line-${index}`,
      account_id: line.account_id || "",
      account_code: line.account_code || "",
      account_label: line.account_code ? `${line.account_code}` : "",
      branch_id: line.branch_id || "",
      cost_center_id: line.cost_center_id || "",
      description: line.description || "",
      reference: line.reference || "",
      debit: Number(line.debit) > 0 ? formatAmountPayload(String(line.debit)) || "" : "",
      credit: Number(line.credit) > 0 ? formatAmountPayload(String(line.credit)) || "" : ""
    }))
  }
}

export function serializeFormSnapshot(form) {
  return JSON.stringify({
    entry_date: form.entry_date,
    description: form.description,
    reference: form.reference,
    lines: form.lines.map((line) => ({
      account_id: line.account_id,
      branch_id: line.branch_id,
      cost_center_id: line.cost_center_id,
      description: line.description,
      reference: line.reference,
      debit: line.debit,
      credit: line.credit
    }))
  })
}

export function isDimensionRule(value) {
  return DIMENSION_RULES.includes(String(value || "").trim().toLowerCase())
}

/** Filtro por sucursal en listado: pendiente de RPC/reportes server-side (fase reportes). */
export const JOURNAL_BRANCH_FILTER_DEFERRED =
  "El filtro por sucursal en el listado llegará con reportes/RPC de consulta server-side."

export function isJournalFormDirty(form, savedSnapshot) {
  return serializeFormSnapshot(form) !== savedSnapshot
}
