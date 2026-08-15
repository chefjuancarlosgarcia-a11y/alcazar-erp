import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { listFinanceChartAccounts } from "../../services/financeChartAccountsService"
import {
  listBranches,
  listFinanceAccountingPeriods,
  listFinanceCostCenters
} from "../../services/financeAccountingFoundationService"
import {
  approveFinanceJournalEntry,
  createFinanceJournalDraft,
  getFinanceJournalEntry,
  listFinanceJournalEntries,
  postFinanceJournalEntry,
  rejectFinanceJournalEntry,
  replaceFinanceJournalLines,
  reverseFinanceJournalEntry,
  submitFinanceJournalEntry
} from "../../services/financeJournalService"
import { journalPermissionsForUser, canViewAccountingJournal } from "../../utils/financePermissions"
import {
  canPerformJournalAction,
  filterPostableAccounts,
  formFromEntry,
  journalActionsForRole,
  lineTotals,
  serializeFormSnapshot
} from "../../utils/financeJournalValidation"
import { persistJournalDraft, submitJournalEntryFlow } from "../../utils/financeJournalPersist"
import { confirmDiscardJournalChanges, createJournalLeaveGuard, UNSAVED_JOURNAL_CONFIRM } from "../../utils/financeJournalUnsaved"
import { centsToDecimalNumber } from "../../utils/financeJournalAmounts"
import FinanceJournalEntryList from "./FinanceJournalEntryList"
import FinanceJournalEntryEditor from "./FinanceJournalEntryEditor"
import { Field } from "./FinanceJournalField"
import {
  defaultMonthRange,
  emptyJournalDraftForm,
  emptyJournalLine
} from "./financeUtils"
import "./Finance.css"

export default function FinanceJournalEntriesTab({ user, notify, leaveGuardRef }) {
  const permissions = useMemo(() => journalPermissionsForUser(user), [user])
  const defaultRange = useMemo(() => defaultMonthRange(), [])

  const [entries, setEntries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [branches, setBranches] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [periods, setPeriods] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [pendingAction, setPendingAction] = useState("")
  const [page, setPage] = useState(1)

  const [filters, setFilters] = useState({
    fromDate: defaultRange.from,
    toDate: defaultRange.to,
    periodId: "",
    status: "",
    search: ""
  })

  const [selectedId, setSelectedId] = useState(null)
  const [entry, setEntry] = useState(null)
  const [isLocalDraft, setIsLocalDraft] = useState(false)
  const [form, setForm] = useState(emptyJournalDraftForm())
  const [savedSnapshot, setSavedSnapshot] = useState(serializeFormSnapshot(emptyJournalDraftForm()))

  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [reverseOpen, setReverseOpen] = useState(false)
  const [reverseReason, setReverseReason] = useState("")
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10))
  const [confirmPostOpen, setConfirmPostOpen] = useState(false)

  const [accountQueries, setAccountQueries] = useState({})
  const pendingRef = useRef(false)

  const postableAccounts = useMemo(() => filterPostableAccounts(accounts), [accounts])
  const accountsById = useMemo(
    () => new Map(postableAccounts.map((row) => [row.id, row])),
    [postableAccounts]
  )

  const isDirty = useMemo(
    () => serializeFormSnapshot(form) !== savedSnapshot,
    [form, savedSnapshot]
  )

  const isEditable = isLocalDraft || entry?.status === "draft"
  const status = isLocalDraft ? "draft" : entry?.status || "draft"
  const allowedActions = journalActionsForRole(status, permissions)

  const totals = useMemo(() => lineTotals(form.lines), [form.lines])
  const difference = centsToDecimalNumber(totals.debitCents - totals.creditCents)

  const reloadEntrySilent = useCallback(async (id) => {
    const result = await getFinanceJournalEntry(id)
    return result
  }, [])

  const applyEntryToEditor = useCallback((detail) => {
    if (!detail) return
    setEntry(detail)
    const nextForm = formFromEntry(detail)
    setForm(nextForm)
    setSavedSnapshot(serializeFormSnapshot(nextForm))
  }, [])

  const loadReferenceData = useCallback(async () => {
    const [accountsRes, branchesRes, ccRes, periodsRes] = await Promise.all([
      listFinanceChartAccounts({ includeInactive: true }),
      listBranches({ isActive: true }),
      listFinanceCostCenters({ includeInactive: true }),
      listFinanceAccountingPeriods({})
    ])
    if (accountsRes.error) notify(accountsRes.error, "error")
    else setAccounts(accountsRes.data)
    if (branchesRes.error) notify(branchesRes.error, "error")
    else setBranches(branchesRes.data.filter((row) => row.is_active))
    if (ccRes.error) notify(ccRes.error, "error")
    else setCostCenters(ccRes.data)
    if (periodsRes.error) notify(periodsRes.error, "error")
    else setPeriods(periodsRes.data)
  }, [notify])

  const loadEntries = useCallback(async () => {
    if (!permissions.canView) return
    setLoadingList(true)
    const result = await listFinanceJournalEntries({
      status: filters.status || null,
      periodId: filters.periodId || null,
      fromDate: filters.fromDate || null,
      toDate: filters.toDate || null,
      search: filters.search || null
    })
    setLoadingList(false)
    if (result.error) {
      notify(result.error, "error")
      return
    }
    setEntries(result.data)
    setPage(1)
  }, [filters, notify, permissions.canView])

  const loadEntryDetail = useCallback(async (id) => {
    setLoadingDetail(true)
    const result = await getFinanceJournalEntry(id)
    setLoadingDetail(false)
    if (result.error) {
      notify(result.error, "error")
      return null
    }
    return result.data
  }, [notify])

  useEffect(() => {
    if (!canViewAccountingJournal(user)) return
    loadReferenceData()
  }, [loadReferenceData, user])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  useEffect(() => {
    if (!leaveGuardRef) return
    leaveGuardRef.current = createJournalLeaveGuard(isDirty)
  }, [isDirty, leaveGuardRef])

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return undefined
    function onDocumentClick(event) {
      const anchor = event.target.closest("a[href]")
      if (!anchor || anchor.target === "_blank") return
      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return
      if (!window.confirm(UNSAVED_JOURNAL_CONFIRM)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener("click", onDocumentClick, true)
    return () => document.removeEventListener("click", onDocumentClick, true)
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return undefined
    function onPopState() {
      if (!window.confirm(UNSAVED_JOURNAL_CONFIRM)) {
        window.history.pushState(null, "", window.location.href)
      }
    }
    window.history.pushState(null, "", window.location.href)
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [isDirty])

  function resetEditor() {
    setSelectedId(null)
    setEntry(null)
    setIsLocalDraft(false)
    const empty = emptyJournalDraftForm()
    setForm(empty)
    setSavedSnapshot(serializeFormSnapshot(empty))
    setAccountQueries({})
  }

  function requestCloseEditor() {
    if (!confirmDiscardJournalChanges(isDirty)) return
    resetEditor()
  }

  function openLocalDraft() {
    if (!confirmDiscardJournalChanges(isDirty)) return
    const empty = emptyJournalDraftForm()
    setSelectedId(null)
    setEntry(null)
    setIsLocalDraft(true)
    setForm(empty)
    setSavedSnapshot(serializeFormSnapshot(empty))
    setAccountQueries({})
  }

  async function openEntry(row) {
    if (!confirmDiscardJournalChanges(isDirty)) return
    setSelectedId(row.id)
    setIsLocalDraft(false)
    const detail = await loadEntryDetail(row.id)
    if (!detail) return
    applyEntryToEditor(detail)
  }

  function updateLine(index, patch) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    }))
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, emptyJournalLine(current.lines.length + 1)]
    }))
  }

  function duplicateLine(index) {
    setForm((current) => {
      const source = current.lines[index]
      const copy = { ...source, key: `dup-${Date.now()}-${index}` }
      const lines = [...current.lines]
      lines.splice(index + 1, 0, copy)
      return { ...current, lines }
    })
  }

  function removeLine(index) {
    setForm((current) => ({
      ...current,
      lines: current.lines.length <= 2 ? current.lines : current.lines.filter((_, i) => i !== index)
    }))
  }

  function selectAccount(index, account) {
    updateLine(index, {
      account_id: account.id,
      account_code: account.code,
      account_label: `${account.code} — ${account.name}`,
      branch_id: account.branch_dimension_rule === "prohibited" ? "" : form.lines[index]?.branch_id || "",
      cost_center_id: account.cost_center_dimension_rule === "prohibited" ? "" : form.lines[index]?.cost_center_id || ""
    })
    setAccountQueries((current) => ({ ...current, [index]: `${account.code} — ${account.name}` }))
  }

  async function runAction(actionName, fn) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPendingAction(actionName)
    try {
      await fn()
    } finally {
      pendingRef.current = false
      setPendingAction("")
    }
  }

  async function handlePartialPersistResult(result) {
    if (result.entryId) {
      setSelectedId(result.entryId)
      setIsLocalDraft(false)
    }
    if (result.data) {
      applyEntryToEditor(result.data)
    } else if (result.entryId) {
      const detail = await loadEntryDetail(result.entryId)
      if (detail) applyEntryToEditor(detail)
    }
    await loadEntries()
  }

  async function handleSaveDraft() {
    if (!canPerformJournalAction(status, "save_draft", permissions)) {
      return notify("No tienes permiso para guardar partidas.", "error")
    }
    await runAction("save", async () => {
      const result = await persistJournalDraft({
        form,
        accountsById,
        entryId: selectedId,
        isLocalDraft,
        createDraft: createFinanceJournalDraft,
        replaceLines: replaceFinanceJournalLines,
        reloadEntry: reloadEntrySilent
      })
      if (!result.ok) {
        await handlePartialPersistResult(result)
        notify(result.message || result.error, "error")
        return
      }
      applyEntryToEditor(result.data)
      await loadEntries()
      notify("Borrador guardado.", "success")
    })
  }

  async function handleSubmit() {
    if (!canPerformJournalAction(status, "submit", permissions)) {
      return notify("No tienes permiso para enviar partidas.", "error")
    }
    await runAction("submit", async () => {
      const result = await submitJournalEntryFlow({
        form,
        accountsById,
        entryId: selectedId,
        isLocalDraft,
        createDraft: createFinanceJournalDraft,
        replaceLines: replaceFinanceJournalLines,
        submitEntry: submitFinanceJournalEntry,
        reloadEntry: reloadEntrySilent
      })
      if (!result.ok) {
        await handlePartialPersistResult(result)
        notify(result.message || result.error, "error")
        return
      }
      applyEntryToEditor(result.data)
      await loadEntries()
      notify("Partida enviada a aprobación.", "success")
    })
  }

  async function reloadCurrentEntryAfterError() {
    if (!entry?.id) return
    const detail = await loadEntryDetail(entry.id)
    if (detail) applyEntryToEditor(detail)
  }

  async function handleApprove() {
    if (!canPerformJournalAction(status, "approve", permissions)) {
      return notify("No tienes permiso para aprobar.", "error")
    }
    await runAction("approve", async () => {
      const result = await approveFinanceJournalEntry(entry.id)
      if (result.error) {
        notify(result.error, "error")
        await reloadCurrentEntryAfterError()
        return
      }
      applyEntryToEditor(result.data)
      await loadEntries()
      notify("Partida aprobada.", "success")
    })
  }

  async function handleRejectSubmit(event) {
    event.preventDefault()
    if (!canPerformJournalAction(status, "reject", permissions)) {
      return notify("No tienes permiso para rechazar.", "error")
    }
    const reason = rejectReason.trim()
    if (!reason) return notify("El motivo de rechazo es obligatorio.", "error")
    await runAction("reject", async () => {
      const result = await rejectFinanceJournalEntry(entry.id, reason)
      if (result.error) {
        notify(result.error, "error")
        await reloadCurrentEntryAfterError()
        return
      }
      setRejectOpen(false)
      setRejectReason("")
      applyEntryToEditor(result.data)
      await loadEntries()
      notify("Partida rechazada y devuelta a borrador.", "success")
    })
  }

  async function handlePostConfirm() {
    if (!canPerformJournalAction(status, "post", permissions)) {
      return notify("No tienes permiso para contabilizar.", "error")
    }
    setConfirmPostOpen(false)
    await runAction("post", async () => {
      const result = await postFinanceJournalEntry(entry.id)
      if (result.error) {
        notify(result.error, "error")
        await reloadCurrentEntryAfterError()
        return
      }
      applyEntryToEditor(result.data)
      await loadEntries()
      notify(`Partida contabilizada como ${result.data.entry_number}.`, "success")
    })
  }

  async function handleReverseSubmit(event) {
    event.preventDefault()
    if (!canPerformJournalAction(status, "reverse", permissions)) {
      return notify("No tienes permiso para revertir.", "error")
    }
    const reason = reverseReason.trim()
    if (!reason) return notify("El motivo de reversión es obligatorio.", "error")
    await runAction("reverse", async () => {
      const result = await reverseFinanceJournalEntry(entry.id, reason, reverseDate)
      if (result.error) {
        notify(result.error, "error")
        await reloadCurrentEntryAfterError()
        return
      }
      notify(`Reversión creada: ${result.data.entry_number}.`, "success")
      setReverseOpen(false)
      setReverseReason("")
      await loadEntries()
      const detail = await loadEntryDetail(entry.id)
      if (detail) applyEntryToEditor(detail)
    })
  }

  if (!permissions.canView) {
    return (
      <article className="finance-panel">
        <p className="tasks-muted">No tienes permiso para consultar partidas contables.</p>
      </article>
    )
  }

  return (
    <>
      <div className="finance-journal-layout">
        <FinanceJournalEntryList
          entries={entries}
          periods={periods}
          filters={filters}
          onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          page={page}
          onPageChange={setPage}
          loadingList={loadingList}
          selectedId={selectedId}
          onSelectEntry={openEntry}
          onRefresh={loadEntries}
          onNewDraft={openLocalDraft}
          canCreate={permissions.canCreate}
          pendingAction={pendingAction}
        />

        <FinanceJournalEntryEditor
          isLocalDraft={isLocalDraft}
          entry={entry}
          form={form}
          onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          loadingDetail={loadingDetail}
          isEditable={isEditable}
          allowedActions={allowedActions}
          totals={totals}
          difference={difference}
          branches={branches}
          costCenters={costCenters}
          postableAccounts={postableAccounts}
          accountsById={accountsById}
          accountQueries={accountQueries}
          onAccountQueriesChange={(index, value) => setAccountQueries((c) => ({ ...c, [index]: value }))}
          onUpdateLine={updateLine}
          onAddLine={addLine}
          onDuplicateLine={duplicateLine}
          onRemoveLine={removeLine}
          onSelectAccount={selectAccount}
          onClose={requestCloseEditor}
          pendingAction={pendingAction}
          onSaveDraft={handleSaveDraft}
          onSubmit={handleSubmit}
          onApprove={handleApprove}
          onRejectOpen={() => setRejectOpen(true)}
          onPostOpen={() => setConfirmPostOpen(true)}
          onReverseOpen={() => setReverseOpen(true)}
          hasSelection={Boolean(selectedId || isLocalDraft)}
        />
      </div>

      {rejectOpen ? (
        <div className="finance-modal-backdrop" role="presentation" onClick={() => setRejectOpen(false)}>
          <form
            className="finance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-reject-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleRejectSubmit}
          >
            <h3 id="journal-reject-title">Rechazar partida</h3>
            <Field label="Motivo (obligatorio)" className="finance-field--full" htmlFor="journal-reject-reason">
              <textarea id="journal-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} required />
            </Field>
            <div className="finance-actions">
              <button type="button" className="tasks-secondary" onClick={() => setRejectOpen(false)}>Cancelar</button>
              <button type="submit" className="tasks-primary" disabled={pendingAction === "reject"}>Confirmar rechazo</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmPostOpen ? (
        <div className="finance-modal-backdrop" role="presentation" onClick={() => setConfirmPostOpen(false)}>
          <div
            className="finance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-post-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="journal-post-title">Contabilizar partida</h3>
            <p>Esta acción asignará número definitivo e inmutabilizará la partida. ¿Desea continuar?</p>
            <div className="finance-actions">
              <button type="button" className="tasks-secondary" onClick={() => setConfirmPostOpen(false)}>Cancelar</button>
              <button type="button" className="tasks-primary" disabled={pendingAction === "post"} onClick={handlePostConfirm}>
                {pendingAction === "post" ? "Contabilizando…" : "Confirmar contabilización"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reverseOpen ? (
        <div className="finance-modal-backdrop" role="presentation" onClick={() => setReverseOpen(false)}>
          <form
            className="finance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-reverse-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleReverseSubmit}
          >
            <h3 id="journal-reverse-title">Revertir partida contabilizada</h3>
            <p className="tasks-muted">Se creará una contra-partida contabilizada. Esta operación no se puede deshacer.</p>
            <Field label="Fecha de reversión" htmlFor="journal-reverse-date">
              <input id="journal-reverse-date" type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} required />
            </Field>
            <Field label="Motivo (obligatorio)" className="finance-field--full" htmlFor="journal-reverse-reason">
              <textarea id="journal-reverse-reason" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} rows={3} required />
            </Field>
            <div className="finance-actions">
              <button type="button" className="tasks-secondary" onClick={() => setReverseOpen(false)}>Cancelar</button>
              <button type="submit" className="tasks-secondary" disabled={pendingAction === "reverse"}>
                {pendingAction === "reverse" ? "Revirtiendo…" : "Confirmar reversión"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
