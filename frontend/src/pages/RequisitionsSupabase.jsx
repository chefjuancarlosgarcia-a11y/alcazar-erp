import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import PaginationControls from "../components/PaginationControls"
import { ToastContainer } from "../components/ToastContainer"
import { TestFlowBadge, TestFlowControls, TestFlowWarning } from "../components/TestFlowBadge"
import { useToast } from "../hooks/useToast"
import { pageItems } from "../utils/pagination"
import { canCreateTestFlow, TEST_FLOW_FILTER } from "../utils/testFlowMode"
import { useAuth } from "../context/AuthContext"
import { supabase } from "../lib/supabase"
import { getActiveAreas } from "../services/areasService"
import { resolveUserProductionAreaIds } from "../services/productionAreasService"
import { getActiveInventoryItems, getInventoryItemByBarcode } from "../services/inventoryService"
import { inventoryItemMatchesBarcode } from "../utils/barcodeUtils"
import BarcodeScannerInput from "../components/inventory/BarcodeScannerInput"
import "../components/inventory/BarcodeScannerInput.css"
import {
  addLowStockItemsToTodayPurchaseOrder,
  approveRequisition,
  cancelRequisition,
  completeRequisition,
  createRequisition,
  deleteClosedRequisition,
  duplicateRequisitionWithCurrentUnits,
  getInventoryUnitConversions,
  getRequisitionById,
  getRequisitionLowStockImpacts,
  getRequisitions,
  ignoreLowStockPurchaseSuggestion,
  rejectRequisition,
  submitRequisition,
  updateRequisition
} from "../services/requisitionsService"
import { notifyRoles } from "../services/notificationsService"
import { buildPurchaseOrderNotificationUrl, buildRequisitionNotificationUrl } from "../utils/inventoryNotificationRoutes"
import {
  buildRequisitionConversionPreview,
  getDefaultRequisitionUnit,
  getRequisitionUnitOptions,
  normalizeInventoryUnit,
  resolveItemRequisitionUnitFactor,
  unitsMatch
} from "../utils/inventoryUnitConversion"
import {
  buildDuplicateResultMessage,
  buildDuplicateResultSummary,
  duplicateModeDescription,
  duplicateModeTitle,
  DUPLICATION_MODES,
  formatDuplicateWarning,
  getRequisitionDuplicateActions
} from "../utils/requisitionDuplicateUtils"
import "./RequisitionsSupabase.css"

const TABS = [
  ["all", "Todas"],
  ["draft", "Borradores"],
  ["pending", "Pendientes"],
  ["approved", "Aprobadas"],
  ["partially_fulfilled", "Parcialmente surtidas"],
  ["pending_fulfillment", "Pendientes de surtir"],
  ["completed", "Completadas"],
  ["rejected", "Rechazadas"],
  ["cancelled", "Canceladas"]
]

const STATUS_LABELS = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  completed: "Completada",
  partially_fulfilled: "Parcialmente surtida",
  pending_fulfillment: "Pendiente de surtir",
  rejected: "Rechazada",
  cancelled: "Cancelada"
}

const SHORTAGE_REASONS = [
  { value: "sin_existencia", label: "Sin existencia en almacén" },
  { value: "vencido_danado", label: "Producto vencido/dañado" },
  { value: "error_solicitud", label: "Error en solicitud" },
  { value: "otro", label: "Otro" }
]

const FULFILLMENT_STATUS_LABELS = {
  fulfilled: "Completo",
  partial: "Parcial",
  out_of_stock: "Sin stock",
  pending_fulfillment: "Pendiente"
}

const PURCHASE_SUGGESTION_SOURCE_LABELS = {
  requisition_shortage: "Faltante requisición",
  low_stock: "Stock mínimo",
  both: "Faltante + mínimo"
}

const PRIORITY_LABELS = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente"
}

const STOCK_OVERRIDE_ROLES = new Set(["supervisor", "gerente", "gerente_general", "admin"])
const UNIT_LABELS = {
  unidad: "Unidad",
  unidades: "Unidad",
  libra: "Libra",
  libras: "Libra",
  kilogramo: "Kilogramo",
  kilogramos: "Kilogramo",
  kg: "Kilogramo",
  gramo: "Gramo",
  gramos: "Gramo",
  g: "Gramo",
  onza: "Onza",
  onzas: "Onza",
  oz: "Onza"
}

const AREA_DISPLAY_ICONS = {
  almacen: "📦",
  cafeteria: "☕",
  cocina: "🍕",
  pizzeria: "🍕",
  barra: "🍸",
  mesas: "🍽️",
  caja: "💵",
  limpieza: "🧹",
  panaderia: "🥖",
  reposteria: "🍰"
}

const REQUESTER_ROLES = new Set([
  "admin",
  "administrador",
  "gerente_general",
  "gerente general",
  "recursos_humanos",
  "rrhh",
  "rr.hh.",
  "encargado_almacen",
  "encargado de almacen",
  "encargado de almacén",
  "supervisor",
  "supervisores",
  "bartender",
  "barista",
  "limpieza"
])

function RequisitionsSupabase({
  initialRequisitionId = "",
  initialTab = "",
  initialApproveId = "",
  initialTestFlowFilter = TEST_FLOW_FILTER.REAL,
  initialFocus = false
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [requisitions, setRequisitions] = useState([])
  const [areas, setAreas] = useState([])
  const [inventory, setInventory] = useState([])
  const [unitConversions, setUnitConversions] = useState([])
  const [requesters, setRequesters] = useState([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState("")
  const [formSaving, setFormSaving] = useState(false)
  const [duplicateSaving, setDuplicateSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState("all")
  const [filters, setFilters] = useState({ date: "", fromAreaId: "", toAreaId: "", priority: "", search: "" })
  const [formRequest, setFormRequest] = useState(null)
  const [detail, setDetail] = useState(null)
  const [approval, setApproval] = useState(null)
  const [fulfillment, setFulfillment] = useState(null)
  const [lowStockSuggestion, setLowStockSuggestion] = useState(null)
  const [duplicateModal, setDuplicateModal] = useState(null)
  const [duplicateResult, setDuplicateResult] = useState(null)
  const [duplicateWarningsOpen, setDuplicateWarningsOpen] = useState(false)
  const { toasts, showToast, dismissToast } = useToast()
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [testFlowFilter, setTestFlowFilter] = useState(initialTestFlowFilter || TEST_FLOW_FILTER.REAL)
  const [createTestMode, setCreateTestMode] = useState(false)
  const [focusedRequisitionId, setFocusedRequisitionId] = useState(initialFocus ? initialRequisitionId : "")
  const [userProductionAreaIds, setUserProductionAreaIds] = useState([])
  const deepLinkHandledRef = useRef(false)

  const manager = ["admin", "gerente_general"].includes(user?.role)
  const isWarehouseManager = user?.role === "encargado_almacen"
  const isElevated = manager || isWarehouseManager
  const canApprove = isElevated
  const canComplete = isElevated
  const warehouseArea = useMemo(() => findWarehouseArea(areas), [areas])
  const operationalAreaIds = useMemo(
    () => buildOperationalAreaIds(areas, user, userProductionAreaIds),
    [areas, user, userProductionAreaIds]
  )
  const inventoryDestinationAreas = useMemo(
    () => areas.filter((area) => area.canRequestInventory !== false && area.id !== warehouseArea?.id),
    [areas, warehouseArea]
  )
  const allowedDestinationAreas = isElevated
    ? inventoryDestinationAreas
    : areas.filter((area) => operationalAreaIds.includes(area.id))
  const canCreate = isElevated || (operationalAreaIds.length > 0 && Boolean(warehouseArea))
  const missingRequisitionArea = !isElevated && operationalAreaIds.length === 0
  const missingWarehouseArea = !isElevated && operationalAreaIds.length > 0 && !warehouseArea

  async function notifyRequisitionPending(requisition) {
    if (!requisition || requisition.status !== "pending") return
    try {
      await notifyRoles(["admin", "gerente_general"], {
        type: "requisition_pending",
        title: requisition.is_test ? "Prueba de requisición pendiente" : "Requisición pendiente de aprobación",
        message: `${requisition.requisition_number} requiere revisión administrativa.`,
        entityType: "requisition",
        entityId: requisition.id,
        entityStatus: requisition.status,
        entityIsTest: requisition.is_test,
        actionUrl: buildRequisitionNotificationUrl(requisition)
      })
    } catch (notificationError) {
      console.error("No se pudo registrar la notificación de requisición pendiente.", notificationError)
    }
  }

  useEffect(() => {
    if (loading || deepLinkHandledRef.current) return
    if (!initialRequisitionId && !initialApproveId) return
    const target = requisitions.find((request) => String(request.id) === String(initialRequisitionId || initialApproveId))
    if (!target) return
    deepLinkHandledRef.current = true
    if (initialTab) setTab(initialTab)
    if (target.is_test && testFlowFilter === TEST_FLOW_FILTER.REAL) {
      setTestFlowFilter(TEST_FLOW_FILTER.TEST)
    }
    setFocusedRequisitionId(String(target.id))
    window.setTimeout(() => setFocusedRequisitionId(""), 6000)
    if (initialApproveId && canApprove) {
      setApproval(target)
    } else {
      setDetail(target)
    }
  }, [loading, requisitions, initialRequisitionId, initialApproveId, initialTab, canApprove, testFlowFilter])

  const canCreateTest = canCreateTestFlow(user)
  const canUseStockOverrideToggle = STOCK_OVERRIDE_ROLES.has(user?.role)
  const hasLegacy = readLegacyRequests().length > 0
  const userAreaIdSet = useMemo(() => new Set(operationalAreaIds), [operationalAreaIds])

  const loadData = useCallback(async (options = {}) => {
    const activeTestFilter = options.testFlowFilter ?? testFlowFilter
    setLoading(true)
    const [requestsResult, areasResult, inventoryResult, requestersResult, conversionsResult] = await Promise.all([
      getRequisitions({ testFlowFilter: activeTestFilter }),
      getActiveAreas(),
      getActiveInventoryItems(),
      getAuthorizedRequesters(),
      getInventoryUnitConversions()
    ])
    const productionAreaIds = await resolveUserProductionAreaIds(user)
    const loadError = requestsResult.error || areasResult.error || inventoryResult.error || requestersResult.error
    if (loadError) setError(`No se pudieron cargar requisiciones: ${loadError.message}`)
    else {
      setRequisitions(requestsResult.data)
      setAreas(areasResult.data)
      setInventory(inventoryResult.data)
      setRequesters(requestersResult.data)
      setUnitConversions(conversionsResult.error ? [] : conversionsResult.data)
      setUserProductionAreaIds(productionAreaIds)
      setError("")
    }
    setLoading(false)
  }, [testFlowFilter, user])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadData()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  const visibleRequests = useMemo(() => requisitions.filter((request) => {
    if (!isElevated && !userAreaIdSet.has(request.to_area_id) && !userAreaIdSet.has(request.from_area_id)) {
      return false
    }
    if (tab !== "all" && request.status !== tab) return false
    if (filters.date && !String(request.created_at || "").startsWith(filters.date)) return false
    if (filters.fromAreaId && request.from_area_id !== filters.fromAreaId) return false
    if (filters.toAreaId && request.to_area_id !== filters.toAreaId) return false
    if (filters.priority && request.priority !== filters.priority) return false
    const term = filters.search.trim().toLowerCase()
    return !term || [request.requisition_number, request.requestedByName, areaName(areas, request.to_area_id)]
      .some((value) => String(value || "").toLowerCase().includes(term))
  }), [areas, filters, isElevated, requisitions, tab, userAreaIdSet])
  const pagedRequests = pageItems(visibleRequests, page)

  function openNew() {
    if (missingWarehouseArea) {
      setError("No existe un área de Almacén activa. Contacta a administración.")
      return
    }
    setFormRequest({
      id: "",
      fromAreaId: isElevated
        ? (warehouseArea?.id || areas[0]?.id || "")
        : (warehouseArea?.id || ""),
      toAreaId: isElevated
        ? (allowedDestinationAreas[0]?.id || "")
        : (operationalAreaIds.length === 1 ? operationalAreaIds[0] : ""),
      priority: "normal",
      requestedByProfileId: isElevated ? defaultRequesterId(requesters, user) : (user?.id || ""),
      notes: "",
      allowOverStock: true,
      isTest: createTestMode,
      items: []
    })
  }

  function openEdit(request) {
    setFormRequest({
      id: request.id,
      fromAreaId: request.from_area_id,
      toAreaId: request.to_area_id,
      priority: request.priority,
      requestedByProfileId: request.requested_by_profile_id || request.requested_by || defaultRequesterId(requesters, user),
      notes: request.notes || "",
      allowOverStock: true,
      isTest: Boolean(request.is_test),
      items: request.items.map((item) => ({
        id: item.id,
        itemId: item.item_id,
        requestedQuantity: item.requested_quantity,
        requestedUnit: item.requested_unit || item.unit,
        notes: item.notes || "",
        conversionWarning: Boolean(item.conversion_warning),
        storedConversionFactor: item.conversion_factor,
        convertedRequestedQuantity: item.converted_requested_quantity
      }))
    })
  }

  async function saveRequest(data, submit) {
    setError("")
    setMessage("")
    const enrichedData = {
      ...data,
      items: enrichRequestItems(data.items, inventory, data.fromAreaId, unitConversions)
    }
    const conversionError = validateRequisitionConversions(enrichedData.items, inventory, unitConversions)
    if (conversionError) {
      setError(conversionError)
      return { ok: false, error: conversionError }
    }
    const validation = validateRequest(enrichedData, inventory, areas)
    if (validation) {
      setError(validation)
      return { ok: false, error: validation }
    }

    setFormSaving(true)
    let pendingRecord = null
    let successMessage = ""
    let nextFilter = testFlowFilter
    try {
      const result = enrichedData.id
        ? await updateRequisition(enrichedData.id, enrichedData, enrichedData.items)
        : await createRequisition(enrichedData, enrichedData.items, submit)

      let actionError = result.error
      pendingRecord = result.data

      if (!actionError && enrichedData.id && submit) {
        const submitResult = await submitRequisition(enrichedData.id)
        actionError = submitResult.error
        if (!actionError) pendingRecord = submitResult.data
      }

      if (actionError) {
        const friendlyError = requisitionError(actionError)
        setError(friendlyError)
        showToast(friendlyError, "error", 7000)
        return { ok: false, error: friendlyError }
      }

      const isTest = Boolean(enrichedData.isTest ?? enrichedData.is_test)
      successMessage = submit
        ? isTest
          ? "Prueba de flujo enviada para aprobación."
          : "Requisición enviada para aprobación."
        : isTest
          ? "Borrador de prueba guardado correctamente."
          : "Borrador guardado correctamente."

      nextFilter = isTest && testFlowFilter === TEST_FLOW_FILTER.REAL
        ? TEST_FLOW_FILTER.TEST
        : testFlowFilter
      if (submit) setTab("pending")
      setFormRequest(null)
      setMessage(successMessage)
      showToast(successMessage, "success", 5000)

      return { ok: true, message: successMessage, record: pendingRecord, nextFilter, isTest, submit }
    } finally {
      setFormSaving(false)
    }
  }

  async function finalizeSavedRequisition({ record, nextFilter, isTest, submit }) {
    if (submit && record?.status === "pending") {
      void notifyRequisitionPending({ ...record, is_test: isTest })
    }
    if (nextFilter !== testFlowFilter) setTestFlowFilter(nextFilter)
    try {
      await loadData({ testFlowFilter: nextFilter })
    } catch (refreshError) {
      console.error("No se pudo refrescar la lista de requisiciones.", refreshError)
    }
  }

  async function handleComplete(request, items) {
    setWorkingId(request.id)
    setError("")
    const result = await completeRequisition(request.id, items)
    setWorkingId("")
    if (result.error) {
      setError(result.error.message)
      return { ok: false, error: result.error.message }
    }
    const newStatus = result.data?.status || "completed"
    setMessage(
      request.is_test
        ? "Requisición de prueba completada. Traslado simulado registrado."
        : newStatus === "completed"
          ? "Requisición completada. Inventario actualizado."
          : newStatus === "pending_fulfillment"
            ? "Requisición registrada sin entregas. Quedó pendiente de surtir."
            : "Requisición surtida parcialmente. Inventario actualizado."
    )
    setDetail(null)
    setFulfillment(null)
    await loadData()

    if (!request.is_test && canComplete) {
      const impactsResult = await getRequisitionLowStockImpacts(request.id)
      if (impactsResult.error) {
        console.error("No se pudo evaluar sugerencias post-requisición.", impactsResult.error)
        return { ok: true }
      }
      if (impactsResult.data?.length) {
        setLowStockSuggestion({
          requisitionId: request.id,
          requisitionNumber: request.requisition_number,
          request,
          items: impactsResult.data.map((item) => ({
            ...item,
            suggested_quantity: Number(item.suggested_quantity || 1)
          }))
        })
      }
    }
    return { ok: true }
  }

  async function runAction(id, action, successMessage) {
    setWorkingId(id)
    setError("")
    const result = await action()
    setWorkingId("")
    if (result.error) {
      setError(result.error.message)
      return
    }
    setMessage(successMessage)
    setDetail(null)
    await loadData()
  }

  function askReason(label, action) {
    const reason = window.prompt(`Motivo para ${label.toLowerCase()}:`)
    if (reason?.trim()) action(reason.trim())
  }

  function askDeleteClosed(request) {
    const statusLabel = request.status === "rejected" ? "rechazada" : "cancelada"
    const confirmed = window.confirm(
      `¿Eliminar permanentemente ${request.requisition_number} (${statusLabel})?\n\nEsta acción no se puede deshacer. Solo se permiten requisiciones rechazadas o canceladas.`
    )
    if (!confirmed) return
    void runAction(
      request.id,
      () => deleteClosedRequisition(request.id),
      "Requisición eliminada."
    )
  }

  async function handleApprove(values) {
    await runAction(approval.id, () => approveRequisition(approval.id, values), "Requisición aprobada. Ya puede completarse el traslado.")
    setApproval(null)
  }

  async function handleDuplicateConfirm(mode) {
    const request = duplicateModal?.request
    const resolvedMode = mode || duplicateModal?.mode
    if (!request || !resolvedMode) return

    setDuplicateSaving(true)
    setError("")
    setMessage("")
    try {
      const result = await duplicateRequisitionWithCurrentUnits(request.id, resolvedMode)
      if (result.error) {
        setError(result.error.message)
        showToast(result.error.message, "error", 7000)
        return
      }

      const payload = result.data || {}
      const summary = buildDuplicateResultSummary(payload)

      setDuplicateModal(null)
      setDetail(null)
      setDuplicateResult(summary)
      setDuplicateWarningsOpen(false)

      const nextFilter = request.is_test && testFlowFilter === TEST_FLOW_FILTER.REAL
        ? TEST_FLOW_FILTER.TEST
        : testFlowFilter
      if (nextFilter !== testFlowFilter) setTestFlowFilter(nextFilter)

      const fetched = await getRequisitionById(payload.new_requisition_id)
      if (fetched.data) {
        openEdit(fetched.data)
      } else {
        showToast("La requisición se creó, pero no se pudo abrir automáticamente. Actualiza la lista.", "warning", 8000)
      }

      showToast(buildDuplicateResultMessage(payload), "success", 6000)
      void loadData({ testFlowFilter: nextFilter })
    } finally {
      setDuplicateSaving(false)
    }
  }

  return (
    <section className="requisitions-page">
      <header className="requisitions-header">
        <div>
          <p className="requisitions-eyebrow">Supabase Inventory</p>
          <h1>Requisiciones</h1>
          <p className="requisitions-muted">Traslados internos de inventario entre áreas con kardex auditable.</p>
        </div>
        <div className="requisitions-actions">
          {canCreate && <button type="button" className="primary" onClick={openNew}>Nueva requisición</button>}
          <button type="button" onClick={loadData}>Actualizar</button>
        </div>
      </header>

      {missingRequisitionArea && (
        <div className="requisitions-warning">
          Tu usuario no tiene un área asignada para solicitar inventario. Contacta a administración.
        </div>
      )}
      {missingWarehouseArea && (
        <div className="requisitions-warning">
          No existe un área de Almacén activa. No se pueden crear requisiciones operativas hasta que administración la configure.
        </div>
      )}
      {hasLegacy && <div className="requisitions-warning">Existen requisiciones locales antiguas. Deben migrarse a Supabase.</div>}
      {message && <div className="requisitions-success">{message}</div>}
      {error && <div className="requisitions-error">{error}</div>}

      <TestFlowControls
        filter={testFlowFilter}
        onFilterChange={setTestFlowFilter}
        canCreate={canCreateTest}
        createActive={createTestMode}
        onToggleCreate={() => setCreateTestMode((current) => !current)}
        className="requisitions-test-controls"
      />

      <nav className="requisitions-tabs" aria-label="Estados de requisición">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
            {label}<strong>{countStatus(requisitions, value)}</strong>
          </button>
        ))}
      </nav>

      <div className="requisitions-filters">
        <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Buscar número, solicitante o área" />
        <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
        <select value={filters.fromAreaId} onChange={(event) => setFilters({ ...filters, fromAreaId: event.target.value })}>
          <option value="">Todos los orígenes</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <select value={filters.toAreaId} onChange={(event) => setFilters({ ...filters, toAreaId: event.target.value })}>
          <option value="">Todos los destinos</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
          <option value="">Todas las prioridades</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="requisitions-list">
        {loading && <p className="requisitions-empty">Cargando requisiciones...</p>}
        {!loading && pagedRequests.map((request) => {
          const pendingSummary = getRequisitionPendingSummary(request)
          const showPendingSummary = pendingSummary.hasPending
            && (
              tab === "all"
              || ["partially_fulfilled", "pending_fulfillment", "approved"].includes(request.status)
            )
          return (
          <article className={`requisition-card${request.is_test ? " requisition-card--test" : ""}${focusedRequisitionId === String(request.id) ? " requisition-card--focused" : ""}${showPendingSummary ? " requisition-card--has-pending" : ""}`} key={request.id}>
            <div className="requisition-summary">
              <strong>{request.requisition_number}</strong>
              {request.is_test && <TestFlowBadge />}
              <StatusBadge status={request.status} />
              {showPendingSummary && <RequisitionPendingBadge summary={pendingSummary} />}
              <PriorityBadge priority={request.priority} />
            </div>
            <div className="requisition-route">
              <span>{areaName(areas, request.from_area_id)}</span>
              <b aria-hidden="true">→</b>
              <span>{areaName(areas, request.to_area_id)}</span>
            </div>
            <div className="requisition-meta">
              <span>Solicitante: <strong>{request.requestedByName}</strong></span>
              <span>{formatDate(request.created_at)}</span>
              <span>{request.items.length} productos</span>
              {showPendingSummary && (
                <span className="requisition-pending-summary">{formatRequisitionPendingSummary(pendingSummary)}</span>
              )}
            </div>
            <div className="requisition-buttons">
              <button type="button" onClick={() => setDetail(request)}>Ver detalle</button>
              {request.status === "draft" && String(request.requested_by) === String(user?.id) && <button type="button" onClick={() => openEdit(request)}>Editar</button>}
              {request.status === "draft" && String(request.requested_by) === String(user?.id) && (
                <button
                  type="button"
                  className="primary"
                  disabled={workingId === request.id || Boolean(getDraftSubmitBlockReason(request, inventory, unitConversions))}
                  title={getDraftSubmitBlockReason(request, inventory, unitConversions) || ""}
                  onClick={() => runAction(request.id, () => submitRequisition(request.id), "Requisición enviada para aprobación.")}
                >
                  Enviar
                </button>
              )}
              {canApprove && request.status === "pending" && <button type="button" className="primary" onClick={() => setApproval(request)}>Aprobar</button>}
              {canComplete && request.status === "approved" && (
                <button type="button" className="primary" disabled={workingId === request.id} onClick={() => setFulfillment(request)}>
                  Completar traslado
                </button>
              )}
              {canApprove && ["pending", "approved"].includes(request.status) && <button type="button" className="danger" onClick={() => askReason("rechazar", (reason) => runAction(request.id, () => rejectRequisition(request.id, reason), "Requisición rechazada."))}>Rechazar</button>}
              {["draft", "pending", "approved"].includes(request.status) && (canApprove || request.requested_by === user?.id) && <button type="button" className="danger" onClick={() => askReason("cancelar", (reason) => runAction(request.id, () => cancelRequisition(request.id, reason), "Requisición cancelada."))}>Cancelar</button>}
              {canDeleteClosedRequisition(request, user, isElevated) && (
                <button
                  type="button"
                  className="danger"
                  disabled={workingId === request.id}
                  onClick={() => askDeleteClosed(request)}
                >
                  Eliminar
                </button>
              )}
            </div>
          </article>
          )
        })}
        {!loading && <PaginationControls page={page} total={visibleRequests.length} onChange={setPage} />}
        {!loading && !visibleRequests.length && <p className="requisitions-empty">No hay requisiciones para esta selección.</p>}
      </div>

      {formRequest && (
        <RequestForm
          request={formRequest}
          areas={areas}
          originAreas={isElevated ? areas : (warehouseArea ? [warehouseArea] : [])}
          destinationAreas={allowedDestinationAreas}
          inventory={inventory}
          requesters={requesters}
          unitConversions={unitConversions}
          currentUser={user}
          isElevated={isElevated}
          warehouseArea={warehouseArea}
          operationalAreaIds={operationalAreaIds}
          canUseStockOverrideToggle={canUseStockOverrideToggle}
          saving={formSaving}
          onClose={() => {
            if (formSaving) return
            setFormRequest(null)
          }}
          onSave={saveRequest}
          onSaved={finalizeSavedRequisition}
        />
      )}
      {detail && (
        <RequestDetail
          request={detail}
          areas={areas}
          inventory={inventory}
          unitConversions={unitConversions}
          canDuplicate={canCreate}
          canDelete={canDeleteClosedRequisition(detail, user, isElevated)}
          working={duplicateSaving}
          onClose={() => setDetail(null)}
          onDuplicate={(request, mode) => setDuplicateModal({ request, mode })}
          onDelete={askDeleteClosed}
        />
      )}
      {duplicateModal && (
        <DuplicateRequisitionModal
          request={duplicateModal.request}
          initialMode={duplicateModal.mode}
          saving={duplicateSaving}
          onClose={() => setDuplicateModal(null)}
          onConfirm={handleDuplicateConfirm}
        />
      )}
      {duplicateResult && (
        <RequisitionDuplicateResultNotice
          result={duplicateResult}
          onViewDetails={() => setDuplicateWarningsOpen(true)}
          onDismiss={() => setDuplicateResult(null)}
        />
      )}
      {duplicateWarningsOpen && duplicateResult?.warnings?.length > 0 && (
        <DuplicateWarningsModal
          warnings={duplicateResult.warnings}
          requisitionNumber={duplicateResult.requisitionNumber}
          onClose={() => setDuplicateWarningsOpen(false)}
        />
      )}
      {approval && <ApprovalModal request={approval} saving={workingId === approval.id} onClose={() => setApproval(null)} onApprove={handleApprove} />}
      {fulfillment && (
        <FulfillmentModal
          request={fulfillment}
          saving={workingId === fulfillment.id}
          onClose={() => setFulfillment(null)}
          onComplete={(items) => handleComplete(fulfillment, items)}
        />
      )}
      {lowStockSuggestion && (
        <LowStockPurchaseSuggestionModal
          suggestion={lowStockSuggestion}
          saving={Boolean(workingId)}
          onClose={() => setLowStockSuggestion(null)}
          onViewDetail={() => {
            setDetail(lowStockSuggestion.request)
            setLowStockSuggestion(null)
          }}
          onIgnore={async (items) => {
            setWorkingId("low-stock-ignore")
            const result = await ignoreLowStockPurchaseSuggestion(lowStockSuggestion.requisitionId, items)
            setWorkingId("")
            if (result.error) {
              setError(result.error.message)
              return
            }
            setLowStockSuggestion(null)
            setMessage("Sugerencia de compra omitida.")
          }}
          onConfirm={async (items) => {
            setWorkingId("low-stock-add")
            const result = await addLowStockItemsToTodayPurchaseOrder(lowStockSuggestion.requisitionId, items)
            setWorkingId("")
            if (result.error) {
              setError(result.error.message)
              return { ok: false, error: result.error.message }
            }
            setMessage("Productos agregados a la orden de compra de hoy.")
            return { ok: true, data: result.data || {} }
          }}
          onGoToPurchaseOrder={(orderMeta) => {
            setLowStockSuggestion(null)
            navigate(buildPurchaseOrderNotificationUrl({
              id: orderMeta.purchase_order_id,
              status: orderMeta.status
            }))
          }}
        />
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </section>
  )
}

function RequestForm({
  request,
  areas,
  originAreas,
  destinationAreas,
  inventory,
  requesters,
  unitConversions,
  currentUser,
  isElevated,
  warehouseArea,
  operationalAreaIds,
  canUseStockOverrideToggle,
  saving,
  onClose,
  onSave,
  onSaved
}) {
  const [form, setForm] = useState(request)
  const [productQuery, setProductQuery] = useState("")
  const [showResults, setShowResults] = useState(false)
  const [formError, setFormError] = useState("")
  const [formNotice, setFormNotice] = useState("")
  const [barcodeScanValue, setBarcodeScanValue] = useState("")
  const [barcodeScanFeedback, setBarcodeScanFeedback] = useState("")
  const [highlightedItemId, setHighlightedItemId] = useState("")
  const pickerRef = useRef(null)
  const searchInputRef = useRef(null)
  const rowRefs = useRef({})
  const highlightTimerRef = useRef(null)
  const fromArea = areas.find((area) => area.id === form.fromAreaId) || warehouseArea
  const toArea = areas.find((area) => area.id === form.toAreaId)
  const requesterProfile = requesters.find((profile) => String(profile.id) === String(form.requestedByProfileId))
    || (currentUser?.id ? {
      id: currentUser.id,
      full_name: currentUser.fullName || currentUser.name,
      username: currentUser.username,
      role: currentUser.role
    } : null)
  const lockOperationalFields = !isElevated
  const operationalDestinations = destinationAreas.filter((area) => operationalAreaIds.includes(area.id))

  useEffect(() => {
    if (isElevated || !warehouseArea?.id || !currentUser?.id) return
    setForm((prev) => {
      const updates = {}
      if (prev.fromAreaId !== warehouseArea.id) updates.fromAreaId = warehouseArea.id
      if (operationalAreaIds.length === 1 && prev.toAreaId !== operationalAreaIds[0]) {
        updates.toAreaId = operationalAreaIds[0]
      }
      if (String(prev.requestedByProfileId) !== String(currentUser.id)) {
        updates.requestedByProfileId = currentUser.id
      }
      return Object.keys(updates).length ? { ...prev, ...updates } : prev
    })
  }, [isElevated, warehouseArea?.id, currentUser?.id, operationalAreaIds])

  useEffect(() => {
    function closeResults(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setShowResults(false)
    }
    document.addEventListener("mousedown", closeResults)
    return () => document.removeEventListener("mousedown", closeResults)
  }, [])

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), [])

  useEffect(() => {
    if (!highlightedItemId) return undefined
    const row = rowRefs.current[highlightedItemId]
    row?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    return undefined
  }, [highlightedItemId, form.items])

  const filteredProducts = useMemo(() => {
    const term = normalizeSearch(productQuery)
    if (!term) return []
    return inventory.filter((item) => productMatches(item, term)).slice(0, 10)
  }, [inventory, productQuery])

  function clearProductSearch() {
    setProductQuery("")
    setShowResults(false)
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function highlightAddedItem(itemId) {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current)
    setHighlightedItemId(itemId)
    highlightTimerRef.current = window.setTimeout(() => setHighlightedItemId(""), 2200)
  }

  function addOrIncrementItem(item) {
    if (!item) return false
    highlightAddedItem(item.id)
    setForm((current) => {
      const existing = current.items.find((line) => line.itemId === item.id)
      if (existing) {
        const updated = {
          ...existing,
          requestedQuantity: Number(existing.requestedQuantity || 0) + 1
        }
        return {
          ...current,
          items: [updated, ...current.items.filter((line) => line.itemId !== item.id)]
        }
      }
      return {
        ...current,
        items: [{
          itemId: item.id,
          requestedQuantity: 1,
          requestedUnit: getDefaultRequisitionUnit(item),
          notes: ""
        }, ...current.items]
      }
    })
    clearProductSearch()
    setFormError("")
    setFormNotice(`"${item.name}" agregado`)
    return true
  }

  function pickProduct(item) {
    addOrIncrementItem(item)
  }

  async function handleRequisitionBarcodeScan(code) {
    setBarcodeScanFeedback("")
    setFormError("")
    const localMatch = inventory.find((item) => inventoryItemMatchesBarcode(item, code))
    let item = localMatch || null

    if (!item) {
      const { data, error } = await getInventoryItemByBarcode(code)
      if (error?.message) {
        setFormError(error.message)
        setBarcodeScanFeedback("Código no registrado")
        return
      }
      if (!data) {
        setFormError("Código no registrado")
        setBarcodeScanFeedback("Código no registrado")
        return
      }
      item = data
    }

    addOrIncrementItem(item)
    setBarcodeScanValue("")
    setBarcodeScanFeedback(`"${item.name}" agregado`)
  }

  function updateItem(itemId, updates) {
    setForm({ ...form, items: form.items.map((item) => item.itemId === itemId ? { ...item, ...updates } : item) })
  }

  async function submitForm(submit) {
    setFormNotice("")
    const enrichedForm = {
      ...form,
      items: enrichRequestItems(form.items, inventory, form.fromAreaId, unitConversions)
    }
    const conversionError = validateRequisitionConversions(enrichedForm.items, inventory, unitConversions)
    if (conversionError) {
      setFormError(conversionError)
      return
    }
    const validation = validateRequest(enrichedForm, inventory, areas)
    if (validation) {
      setFormError(validation)
      return
    }
    setFormError("")
    const result = await onSave(enrichedForm, submit)
    if (!result?.ok) {
      setFormError(result?.error || "No se pudo guardar la requisición. Intenta de nuevo.")
      return
    }
    setFormNotice(result.message || (submit ? "Requisición enviada." : "Borrador guardado."))
    if (onSaved) {
      void onSaved({
        record: result.record,
        nextFilter: result.nextFilter,
        isTest: result.isTest,
        submit
      })
    }
  }

  return (
    <div className="requisitions-backdrop">
      <form className="requisitions-modal request-form" onSubmit={(event) => { event.preventDefault(); submitForm(false) }}>
        <header>
          <div><p className="requisitions-eyebrow">Traslado interno</p><h2>{form.id ? "Editar borrador" : form.isTest ? "Nueva prueba de flujo" : "Nueva requisición"}</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        {form.isTest && <TestFlowWarning className="requisitions-test-warning" />}
        <div className="requisition-form-grid">
          <Field label="Origen">
            {lockOperationalFields ? (
              <div className="requisition-field-readonly">{areaDisplayLabel(fromArea)}</div>
            ) : (
              <select value={form.fromAreaId} onChange={(event) => setForm({ ...form, fromAreaId: event.target.value })}>
                {originAreas.map((area) => <option key={area.id} value={area.id}>{areaDisplayLabel(area)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Destino">
            {lockOperationalFields && operationalDestinations.length <= 1 ? (
              <div className="requisition-field-readonly">{areaDisplayLabel(toArea || operationalDestinations[0])}</div>
            ) : (
              <select value={form.toAreaId} onChange={(event) => setForm({ ...form, toAreaId: event.target.value })}>
                <option value="">Selecciona destino</option>
                {(lockOperationalFields ? operationalDestinations : destinationAreas).map((area) => (
                  <option key={area.id} value={area.id}>{areaDisplayLabel(area)}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Prioridad">
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Solicitado por">
            {lockOperationalFields ? (
              <div className="requisition-field-readonly">{profileLabel(requesterProfile)}</div>
            ) : (
              <select required value={form.requestedByProfileId || ""} onChange={(event) => setForm({ ...form, requestedByProfileId: event.target.value })}>
                <option value="">Selecciona solicitante</option>
                {requesters.map((profile) => <option key={profile.id} value={profile.id}>{profileLabel(profile)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Notas">
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Motivo o instrucciones" />
          </Field>
          {canUseStockOverrideToggle && (
            <label className="requisition-field toggle">
              <input type="checkbox" checked={form.allowOverStock !== false} onChange={(event) => setForm({ ...form, allowOverStock: event.target.checked })} />
              <span>Permitir requisicion superior al stock</span>
            </label>
          )}
        </div>
        <div className="requisition-picker" ref={pickerRef}>
          <div className="requisition-picker__primary">
            <label className="requisition-picker__label" htmlFor="requisition-product-search">Buscar producto</label>
            <div className="requisition-product-search">
              <span className="requisition-search-icon" aria-hidden="true">⌕</span>
              <input
                id="requisition-product-search"
                ref={searchInputRef}
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value)
                  setShowResults(true)
                  setFormNotice("")
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Escribe el nombre, SKU o categoría del producto..."
                autoComplete="off"
              />
              {productQuery && (
                <button type="button" className="requisition-product-search__clear" onClick={clearProductSearch}>
                  Limpiar
                </button>
              )}
              {showResults && productQuery && (
                <div className="requisition-product-results">
                  {filteredProducts.map((item) => (
                    <button type="button" key={item.id} onClick={() => pickProduct(item)}>
                      {item.image_url ? <img src={item.image_url} alt="" /> : <span className="requisition-product-placeholder">{initials(item.name)}</span>}
                      <strong>{item.name}<small>{item.category || "Sin categoria"} · {item.base_unit}</small></strong>
                      <em>{stockOf(item, form.fromAreaId)} {item.base_unit}</em>
                    </button>
                  ))}
                  {!filteredProducts.length && <p>No se encontraron productos.</p>}
                </div>
              )}
            </div>
            <p className="requisition-picker__hint">Selecciona un resultado para agregarlo de inmediato. Si ya está en la lista, sube su cantidad.</p>
          </div>
          <div className="requisition-picker__scanner">
            <BarcodeScannerInput
              inputId="requisition-barcode-scan"
              label="Escanear producto"
              value={barcodeScanValue}
              onChange={setBarcodeScanValue}
              onScan={handleRequisitionBarcodeScan}
              placeholder="Escanea código de barras para agregar a la requisición..."
              hint="Si el producto ya está en la requisición, aumenta la cantidad."
            />
            {barcodeScanFeedback && (
              <p className="barcode-scanner-feedback barcode-scanner-feedback--success">{barcodeScanFeedback}</p>
            )}
          </div>
        </div>
        {formError && <div className="requisitions-error">{formError}</div>}
        {formNotice && <div className="requisitions-success">{formNotice}</div>}
        <div className="requisition-items">
          <div className="requisition-items-head"><span>Producto</span><span>Stock / disponibilidad</span><span>Cantidad</span><span>Solicitar en</span><span>Conversión</span><span>Notas</span><span /></div>
          {form.items.map((line) => {
            const item = inventory.find((inventoryItem) => inventoryItem.id === line.itemId)
            const unitOptions = getRequisitionUnitOptions(item, unitConversions)
            const requestedUnit = line.requestedUnit || getDefaultRequisitionUnit(item) || item?.base_unit || ""
            const availability = calculateAvailability(
              item,
              form.fromAreaId,
              line.requestedQuantity,
              requestedUnit,
              unitConversions,
              readStoredConversionFactor(line)
                ? {
                  storedConversionFactor: readStoredConversionFactor(line),
                  convertedRequestedQuantity: readStoredConvertedQuantity(line)
                }
                : null
            )
            const preview = buildRequisitionConversionPreview(
              line.requestedQuantity,
              requestedUnit,
              item?.base_unit,
              availability.conversionFactor
            )
            return (
              <div
                className={`requisition-item-row${highlightedItemId === line.itemId ? " requisition-item-row--highlight" : ""}`}
                key={line.itemId}
                ref={(node) => {
                  if (node) rowRefs.current[line.itemId] = node
                  else delete rowRefs.current[line.itemId]
                }}
              >
                <strong>{item?.name || "Producto"}<small>Inventario: {item?.base_unit || ""}</small></strong>
                <span>
                  Actual: {formatNumber(availability.available)} {item?.base_unit} · Minimo: {formatNumber(availability.minimum)} {item?.base_unit}
                  <AvailabilityBadge status={availability.status} />
                  {availability.shortage > 0 && (
                    <small className="requisition-stock-warning">⚠ Stock insuficiente. Solicitado: {formatNumber(availability.requestedBase)} {item?.base_unit}. Disponible: {formatNumber(availability.available)}. Faltante: {formatNumber(availability.shortage)}.</small>
                  )}
                </span>
                <input type="number" min="0.001" step="any" value={line.requestedQuantity} onChange={(event) => updateItem(line.itemId, { requestedQuantity: event.target.value })} />
                <select value={requestedUnit} onChange={(event) => updateItem(line.itemId, { requestedUnit: event.target.value })}>
                  {unitOptions.map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}
                </select>
                <div className="requisition-conversion-preview">
                  {line.conversionWarning && (
                    <span className="requisition-conversion-badge">Conversión no configurada al crear esta requisición</span>
                  )}
                  {availability.conversionError ? (
                    <small className="requisition-stock-warning">{availability.conversionError}</small>
                  ) : preview ? (
                    <>
                      <strong>{preview.expression}</strong>
                      <small>{preview.deduction}</small>
                    </>
                  ) : (
                    <small className="requisitions-muted">Ingresa cantidad y unidad.</small>
                  )}
                </div>
                <input value={line.notes} onChange={(event) => updateItem(line.itemId, { notes: event.target.value })} placeholder="Opcional" />
                <button type="button" className="danger" onClick={() => setForm({ ...form, items: form.items.filter((itemLine) => itemLine.itemId !== line.itemId) })}>Quitar</button>
              </div>
            )
          })}
          {!form.items.length && <p className="requisitions-empty">Agrega al menos un producto inventariable.</p>}
          {form.items.length > 0 && (
            <p className="requisitions-muted requisition-conversion-note">El sistema convertirá automáticamente a la unidad de inventario para descontar stock.</p>
          )}
        </div>
        <div className="requisitions-modal-actions">
          {(formError || formNotice) && (
            <div className="requisitions-modal-feedback">
              {formError && <div className="requisitions-error">{formError}</div>}
              {formNotice && <div className="requisitions-success">{formNotice}</div>}
            </div>
          )}
          <button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" disabled={saving || Boolean(getRequisitionConversionBlockReason(form.items, inventory, unitConversions))} title={getRequisitionConversionBlockReason(form.items, inventory, unitConversions) || ""} onClick={() => submitForm(false)}>
            {saving ? "Guardando..." : "Guardar borrador"}
          </button>
          <button type="button" className="primary" disabled={saving || Boolean(getRequisitionConversionBlockReason(form.items, inventory, unitConversions))} title={getRequisitionConversionBlockReason(form.items, inventory, unitConversions) || ""} onClick={() => submitForm(true)}>
            {saving ? "Enviando..." : "Enviar requisición"}
          </button>
        </div>
      </form>
    </div>
  )
}

function RequestDetail({ request, areas, inventory, unitConversions, canDuplicate, canDelete, working, onClose, onDuplicate, onDelete }) {
  const isFulfilled = ["completed", "partially_fulfilled", "pending_fulfillment"].includes(request.status)
  const duplicateActions = canDuplicate ? getRequisitionDuplicateActions(request.status) : []
  return (
    <div className="requisitions-backdrop">
      <section className="requisitions-modal detail">
        <header>
          <div><p className="requisitions-eyebrow">{request.requisition_number}</p><h2>Detalle de requisición</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        {request.is_test && (
          <>
            <TestFlowBadge />
            <TestFlowWarning className="requisitions-test-warning" />
          </>
        )}
        <div className="requisition-detail-meta">
          <span>Estado <StatusBadge status={request.status} /></span>
          <span>Ruta <strong>{areaName(areas, request.from_area_id)} → {areaName(areas, request.to_area_id)}</strong></span>
          <span>Solicitante <strong>{request.requestedByName}</strong></span>
          <span>Aprobado por <strong>{request.approvedByName || "Pendiente"}</strong></span>
          <span>Completado por <strong>{request.completedByName || "Pendiente"}</strong></span>
          <span>Creada <strong>{formatDate(request.created_at)}</strong></span>
        </div>
        {request.notes && <p className="requisition-note">{request.notes}</p>}
        <div className="requisition-detail-table requisition-detail-table--fulfillment">
          <div>
            <strong>Producto</strong>
            <strong>Solicitado</strong>
            <strong>{isFulfilled ? "Entregado" : "Aprobado"}</strong>
            <strong>Pendiente</strong>
            <strong>Estado</strong>
            <strong>Motivo</strong>
          </div>
          {request.items.map((line) => {
            const item = inventory.find((entry) => entry.id === line.item_id)
            const requestedUnit = line.requested_unit || line.unit || item?.base_unit
            const requestedQty = Number(line.requested_quantity || 0)
            const approvedQty = line.approved_quantity != null ? Number(line.approved_quantity) : null
            const deliveredQty = line.delivered_quantity != null ? Number(line.delivered_quantity) : null
            const shownQty = isFulfilled ? deliveredQty : approvedQty
            const pendingQty = isFulfilled
              ? Number(line.pending_quantity ?? Math.max(requestedQty - Number(deliveredQty || 0), 0))
              : Number(line.pending_quantity ?? Math.max(requestedQty - Number(approvedQty ?? requestedQty), 0))
            const lineStatus = line.fulfillment_status || previewLineFulfillmentStatus(requestedQty, shownQty ?? requestedQty)
            const origin = stockOf(item, request.from_area_id)
            const destination = stockOf(item, request.to_area_id)
            const movedBase = Number(
              line.converted_delivered_quantity
              || line.converted_approved_quantity
              || line.converted_requested_quantity
              || shownQty
              || 0
            )
            const convertedBase = Number(line.converted_requested_quantity || 0)
            const showConversionHint = convertedBase > 0
              && requestedUnit
              && item?.base_unit
              && !unitsMatch(requestedUnit, item.base_unit)
            return (
              <div className={pendingQty > 0 ? "insufficient" : ""} key={line.id}>
                <strong>
                  {line.item_name}
                  {line.conversion_warning && (
                    <span className="requisition-conversion-badge">Conversión no configurada al crear esta requisición</span>
                  )}
                </strong>
                <span>{formatNumber(requestedQty)} {requestedUnit}</span>
                <span>
                  {shownQty != null ? `${formatNumber(shownQty)} ${requestedUnit}` : "-"}
                  {showConversionHint && (
                    <small className="requisitions-muted">≈ {formatNumber(convertedBase)} {item.base_unit} en inventario</small>
                  )}
                </span>
                <span>{formatNumber(pendingQty)} {requestedUnit}</span>
                <span><FulfillmentStatusBadge status={lineStatus} /></span>
                <span>{formatShortageReason(line.shortage_reason, line.shortage_notes)}</span>
                {!isFulfilled && (
                  <small className="requisition-line-stock-hint">
                    Origen: {formatNumber(origin)} → {formatNumber(origin - movedBase)} · Destino: {formatNumber(destination)} → {formatNumber(destination + movedBase)}
                  </small>
                )}
              </div>
            )
          })}
        </div>
        {request.rejection_reason && <div className="requisitions-error">Motivo: {request.rejection_reason}</div>}
        {duplicateActions.length > 0 && (
          <section className="requisition-detail-actions-panel" aria-labelledby="requisition-actions-title">
            <div className="requisition-detail-actions-panel__header">
              <h3 id="requisition-actions-title">Acciones de la requisición</h3>
              <p className="requisitions-muted">
                Crea un documento nuevo en borrador con la configuración actual del inventario. La requisición original no se modifica.
              </p>
            </div>
            <div className="requisition-detail-actions-panel__buttons">
              {duplicateActions.map((action) => (
                <button
                  key={action.mode}
                  type="button"
                  className={`requisition-action-btn requisition-action-btn--${action.tone}${action.badge ? " recommended" : ""}`}
                  disabled={working}
                  onClick={() => onDuplicate(request, action.mode)}
                >
                  <span className="requisition-action-btn__label">{action.label}</span>
                  {action.badge && <span className="requisition-action-btn__badge">{action.badge}</span>}
                </button>
              ))}
            </div>
          </section>
        )}
        {canDelete && (
          <div className="requisition-detail-delete">
            <button type="button" className="danger" disabled={working} onClick={() => onDelete(request)}>
              Eliminar requisición
            </button>
            <p className="requisitions-muted">Solo disponible para requisiciones rechazadas o canceladas.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function DuplicateRequisitionModal({ request, initialMode, saving, onClose, onConfirm }) {
  const actions = getRequisitionDuplicateActions(request.status)
  const selectedAction = actions.find((action) => action.mode === initialMode) || actions[0]
  const mode = initialMode || selectedAction?.mode || DUPLICATION_MODES.FULL
  const [cancelledConfirmed, setCancelledConfirmed] = useState(false)

  if (!selectedAction) return null

  const isTemplate = mode === DUPLICATION_MODES.TEMPLATE
  const requiresCancelledConfirm = Boolean(selectedAction.requiresCancelledConfirm)
  const canSubmit = !requiresCancelledConfirm || cancelledConfirmed

  return (
    <div className="requisitions-backdrop">
      <section className="requisitions-modal duplicate-requisition">
        <header>
          <div>
            <p className="requisitions-eyebrow">{request.requisition_number}</p>
            <h2>{duplicateModeTitle(mode)}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving}>Cerrar</button>
        </header>

        <p>{duplicateModeDescription(mode, request.requisition_number)}</p>

        {requiresCancelledConfirm && (
          <label className="requisition-duplicate-cancelled-confirm">
            <input
              type="checkbox"
              checked={cancelledConfirmed}
              onChange={(event) => setCancelledConfirmed(event.target.checked)}
              disabled={saving}
            />
            <span>Entiendo que esta requisición está cancelada y deseo usarla solo como referencia para una nueva solicitud.</span>
          </label>
        )}

        <div className="requisitions-modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="primary"
            disabled={saving || !canSubmit}
            onClick={() => onConfirm(mode)}
          >
            {saving ? "Creando..." : isTemplate ? "Crear desde plantilla" : "Crear borrador"}
          </button>
        </div>
      </section>
    </div>
  )
}

function RequisitionDuplicateResultNotice({ result, onViewDetails, onDismiss }) {
  return (
    <aside className="requisition-duplicate-result-notice" role="status" aria-live="polite">
      <div className="requisition-duplicate-result-notice__header">
        <strong>Se creó una nueva requisición utilizando la configuración actual.</strong>
        {result.requisitionNumber && <span>{result.requisitionNumber}</span>}
      </div>
      <dl className="requisition-duplicate-result-notice__stats">
        <div><dt>Productos copiados</dt><dd>{result.itemsCopied}</dd></div>
        <div><dt>Productos omitidos</dt><dd>{result.itemsSkipped}</dd></div>
        <div><dt>Advertencias</dt><dd>{result.warningsCount}</dd></div>
      </dl>
      <div className="requisition-duplicate-result-notice__actions">
        {result.warningsCount > 0 && (
          <button type="button" onClick={onViewDetails}>Ver detalles</button>
        )}
        <button type="button" className="primary" onClick={onDismiss}>Entendido</button>
      </div>
    </aside>
  )
}

function DuplicateWarningsModal({ warnings, requisitionNumber, onClose }) {
  return (
    <div className="requisitions-backdrop">
      <section className="requisitions-modal duplicate-requisition">
        <header>
          <div>
            <p className="requisitions-eyebrow">{requisitionNumber || "Nueva requisición"}</p>
            <h2>Productos omitidos</h2>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        <p className="requisitions-muted">Estos productos no se copiaron a la nueva requisición. Revísalos antes de enviar el borrador.</p>
        <ul className="requisition-duplicate-warnings-list">
          {warnings.map((warning, index) => (
            <li key={`${warning.item_id || warning.item_name || "warning"}-${index}`}>
              {formatDuplicateWarning(warning)}
            </li>
          ))}
        </ul>
        <div className="requisitions-modal-actions">
          <button type="button" className="primary" onClick={onClose}>Cerrar</button>
        </div>
      </section>
    </div>
  )
}

function LowStockPurchaseSuggestionModal({ suggestion, saving, onClose, onViewDetail, onIgnore, onConfirm, onGoToPurchaseOrder }) {
  const [items, setItems] = useState(() => suggestion.items.map((item) => ({ ...item })))
  const [successOrder, setSuccessOrder] = useState(null)
  const [localError, setLocalError] = useState("")

  function updateQuantity(itemId, value) {
    const quantity = Number(value)
    setItems((current) => current.map((item) => (
      item.item_id === itemId
        ? { ...item, suggested_quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : item.suggested_quantity }
        : item
    )))
  }

  async function handleConfirm() {
    setLocalError("")
    const payload = items.map((item) => ({
      requisition_item_id: item.requisition_item_id || null,
      item_id: item.item_id,
      pending_quantity: item.pending_quantity,
      stock_after: item.stock_after,
      minimum_stock: item.minimum_stock,
      suggested_quantity: Number(item.suggested_quantity),
      source: item.source || "low_stock"
    }))
    if (payload.some((item) => !item.suggested_quantity || item.suggested_quantity <= 0)) {
      setLocalError("Cada producto debe tener una cantidad sugerida mayor que cero.")
      return
    }
    const result = await onConfirm(payload)
    if (result?.ok) {
      setSuccessOrder(result.data)
    } else if (result?.error) {
      setLocalError(result.error)
    }
  }

  async function handleIgnore() {
    setLocalError("")
    const payload = items.map((item) => ({
      requisition_item_id: item.requisition_item_id || null,
      item_id: item.item_id,
      pending_quantity: item.pending_quantity,
      stock_after: item.stock_after,
      minimum_stock: item.minimum_stock,
      suggested_quantity: Number(item.suggested_quantity),
      source: item.source || "low_stock"
    }))
    await onIgnore(payload)
  }

  return (
    <div className="requisitions-backdrop">
      <div className="requisitions-modal low-stock-suggestion">
        <header>
          <div>
            <p className="requisitions-eyebrow">{suggestion.requisitionNumber}</p>
            <h2>Sugerencias de compra</h2>
            <p className="requisitions-muted">
              Productos con faltante de requisición o en punto mínimo. ¿Deseas agregarlos a la orden de compra de hoy?
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving}>Cerrar</button>
        </header>

        {successOrder ? (
          <div className="low-stock-suggestion-success">
            <p className="requisitions-success">Productos agregados a la orden de compra de hoy.</p>
            <p className="requisitions-muted">
              Orden: <strong>{successOrder.order_number || successOrder.purchase_order_id}</strong>
            </p>
            <div className="requisitions-modal-actions">
              <button type="button" onClick={onClose}>Cerrar</button>
              {successOrder.purchase_order_id && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => onGoToPurchaseOrder(successOrder)}
                >
                  Ir a la orden de compra
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {localError && <p className="requisitions-error">{localError}</p>}
            <div className="low-stock-suggestion-table-wrap">
              <table className="low-stock-suggestion-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Origen</th>
                    <th>Pendiente</th>
                    <th>Stock actual</th>
                    <th>Punto mínimo</th>
                    <th>Unidad</th>
                    <th>Proveedor</th>
                    <th>Cantidad sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.item_id}>
                      <td>
                        <strong>{item.item_name}</strong>
                        {item.sku ? <small>{item.sku}</small> : null}
                      </td>
                      <td>
                        <span className={`purchase-suggestion-source purchase-suggestion-source--${item.source || "low_stock"}`}>
                          {PURCHASE_SUGGESTION_SOURCE_LABELS[item.source] || PURCHASE_SUGGESTION_SOURCE_LABELS.low_stock}
                        </span>
                      </td>
                      <td>{Number(item.pending_quantity || 0) > 0 ? formatNumber(item.pending_quantity) : "—"}</td>
                      <td>{item.stock_after != null ? formatNumber(item.stock_after) : "—"}</td>
                      <td>{item.minimum_stock != null ? formatNumber(item.minimum_stock) : "—"}</td>
                      <td>{item.purchase_unit || item.unit || "—"}</td>
                      <td>{item.supplier || "—"}</td>
                      <td>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={item.suggested_quantity}
                          onChange={(event) => updateQuantity(item.item_id, event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="requisitions-modal-actions">
              <button type="button" onClick={handleIgnore} disabled={saving}>Omitir por ahora</button>
              <button type="button" onClick={onViewDetail} disabled={saving}>Ver detalle</button>
              <button type="button" className="primary" onClick={handleConfirm} disabled={saving}>
                {saving ? "Guardando..." : "Agregar a orden de compra de hoy"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ApprovalModal({ request, saving, onClose, onApprove }) {
  const [items, setItems] = useState(() => buildQuantityLineState(request.items, "approvedQuantity"))
  const [formError, setFormError] = useState("")
  const summary = buildFulfillmentSummary(items, "approvedQuantity")

  function updateLine(id, patch) {
    setItems((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const validationError = validateQuantityLines(items, "approvedQuantity")
    if (validationError) {
      setFormError(validationError)
      return
    }
    setFormError("")
    onApprove(items)
  }

  return (
    <div className="requisitions-backdrop">
      <form className="requisitions-modal approval" onSubmit={handleSubmit}>
        <header>
          <div><p className="requisitions-eyebrow">{request.requisition_number}</p><h2>Aprobar cantidades</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        <QuantityLinesEditor items={items} quantityField="approvedQuantity" onUpdateLine={updateLine} />
        <FulfillmentSummary summary={summary} actionLabel="aprobar" />
        {formError && <div className="requisitions-error">{formError}</div>}
        <div className="requisitions-modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? "Guardando..." : "Aprobar requisición"}</button>
        </div>
      </form>
    </div>
  )
}

function FulfillmentModal({ request, saving, onClose, onComplete }) {
  const [items, setItems] = useState(() => buildQuantityLineState(request.items, "deliveredQuantity", true))
  const [formError, setFormError] = useState("")
  const summary = buildFulfillmentSummary(items, "deliveredQuantity")

  function updateLine(id, patch) {
    setItems((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validationError = validateQuantityLines(items, "deliveredQuantity")
    if (validationError) {
      setFormError(validationError)
      return
    }
    setFormError("")
    const result = await onComplete(items)
    if (result?.error) setFormError(result.error)
  }

  return (
    <div className="requisitions-backdrop">
      <form className="requisitions-modal approval fulfillment" onSubmit={handleSubmit}>
        <header>
          <div><p className="requisitions-eyebrow">{request.requisition_number}</p><h2>Surtir requisición</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        <p className="requisitions-muted">Indica cuánto se entrega realmente por producto. Puedes registrar 0 si no hay existencia.</p>
        <QuantityLinesEditor items={items} quantityField="deliveredQuantity" onUpdateLine={updateLine} />
        <FulfillmentSummary summary={summary} actionLabel="surtir" />
        {formError && <div className="requisitions-error">{formError}</div>}
        <div className="requisitions-modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? "Registrando..." : "Confirmar surtido"}</button>
        </div>
      </form>
    </div>
  )
}

function QuantityLinesEditor({ items, quantityField, onUpdateLine }) {
  return (
    <div className="requisition-quantity-lines">
      {items.map((item) => {
        const requestedQty = Number(item.requested_quantity || 0)
        const quantityValue = item[quantityField]
        const quantityNumber = Number(quantityValue)
        const pendingQty = Math.max(requestedQty - (Number.isFinite(quantityNumber) ? quantityNumber : 0), 0)
        const lineStatus = previewLineFulfillmentStatus(requestedQty, quantityNumber)
        const needsReason = pendingQty > 0
        return (
          <div className="approval-line" key={item.id}>
            <div className="approval-line__header">
              <span>
                {item.item_name}
                <small>Solicitado: {formatNumber(requestedQty)} {item.unit || item.requested_unit}</small>
                {item.conversion_warning && (
                  <span className="requisition-conversion-badge">Conversión no configurada al crear esta requisición</span>
                )}
                {Number(item.conversion_factor) > 0 && Number(item.converted_requested_quantity) > 0 && (
                  <small className="requisitions-muted">
                    Solicitud original: {formatNumber(item.converted_requested_quantity)} u. inventario
                    {Number.isFinite(quantityNumber) && quantityNumber !== requestedQty && (
                      <> · Aprobar {formatNumber(quantityNumber)} {item.unit} ≈ {formatNumber(quantityNumber * Number(item.conversion_factor))} u. inventario</>
                    )}
                  </small>
                )}
              </span>
              <FulfillmentStatusBadge status={lineStatus} />
            </div>
            <label>
              <span>Cantidad {quantityField === "deliveredQuantity" ? "entregada" : "aprobada"}</span>
              <input
                type="number"
                step="any"
                min="0"
                value={quantityValue}
                onChange={(event) => onUpdateLine(item.id, { [quantityField]: event.target.value })}
              />
            </label>
            {pendingQty > 0 && <small className="requisition-pending-hint">Pendiente: {formatNumber(pendingQty)} {item.unit}</small>}
            {needsReason && (
              <>
                <label>
                  <span>Motivo del faltante</span>
                  <select
                    value={item.shortageReason || ""}
                    onChange={(event) => onUpdateLine(item.id, { shortageReason: event.target.value })}
                    required
                  >
                    <option value="">Selecciona un motivo</option>
                    {SHORTAGE_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>{reason.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Notas (opcional)</span>
                  <input
                    value={item.shortageNotes || ""}
                    onChange={(event) => onUpdateLine(item.id, { shortageNotes: event.target.value })}
                    placeholder="Detalle adicional"
                  />
                </label>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FulfillmentSummary({ summary, actionLabel }) {
  if (!summary.total || summary.fulfilled === summary.total) return null
  return (
    <div className="requisition-fulfillment-summary">
      <strong>Esta requisición será {actionLabel === "surtir" ? "surtida" : "aprobada"} parcialmente:</strong>
      <span>Entregados completos: {summary.fulfilled}</span>
      <span>Parciales: {summary.partial}</span>
      <span>Sin stock: {summary.outOfStock}</span>
    </div>
  )
}

function FulfillmentStatusBadge({ status }) {
  const normalized = status || "pending_fulfillment"
  return (
    <span className={`fulfillment-badge fulfillment-badge--${normalized}`}>
      {FULFILLMENT_STATUS_LABELS[normalized] || normalized}
    </span>
  )
}

function RequisitionPendingBadge({ summary }) {
  if (!summary?.hasPending) return null
  return (
    <span className="requisition-pending-badge" title={formatRequisitionPendingSummary(summary)}>
      Pendiente
    </span>
  )
}

function getLinePendingQuantity(line, requestStatus) {
  const requested = Number(line.requested_quantity || 0)
  if (line.pending_quantity != null && line.pending_quantity !== "" && Number.isFinite(Number(line.pending_quantity))) {
    return Math.max(Number(line.pending_quantity), 0)
  }
  if (["completed", "partially_fulfilled", "pending_fulfillment"].includes(requestStatus)) {
    return Math.max(requested - Number(line.delivered_quantity ?? 0), 0)
  }
  if (requestStatus === "approved" && line.approved_quantity != null) {
    return Math.max(requested - Number(line.approved_quantity), 0)
  }
  return 0
}

function getRequisitionPendingSummary(request) {
  const items = request.items || []
  let pendingLines = 0
  let outOfStockLines = 0

  items.forEach((line) => {
    const pending = getLinePendingQuantity(line, request.status)
    if (pending <= 0) return
    pendingLines += 1
    const delivered = line.delivered_quantity != null
      ? Number(line.delivered_quantity)
      : (request.status === "approved" && line.approved_quantity != null ? Number(line.approved_quantity) : null)
    if (line.fulfillment_status === "out_of_stock" || (delivered === 0 && pending > 0)) {
      outOfStockLines += 1
    }
  })

  return { pendingLines, outOfStockLines, hasPending: pendingLines > 0 }
}

function formatRequisitionPendingSummary(summary) {
  if (!summary?.hasPending) return ""
  const parts = [
    `${summary.pendingLines} producto${summary.pendingLines === 1 ? "" : "s"} pendiente${summary.pendingLines === 1 ? "" : "s"}`
  ]
  if (summary.outOfStockLines > 0) {
    parts.push(`${summary.outOfStockLines} sin stock`)
  }
  return parts.join(" · ")
}

function buildQuantityLineState(items, quantityField, useApprovedDefault = false) {
  return items.map((item) => {
    const defaultQty = useApprovedDefault
      ? (item.approved_quantity ?? item.requested_quantity)
      : (item.approved_quantity ?? item.requested_quantity)
    return {
      ...item,
      [quantityField]: String(defaultQty ?? ""),
      shortageReason: item.shortage_reason || "",
      shortageNotes: item.shortage_notes || ""
    }
  })
}

function previewLineFulfillmentStatus(requestedQty, quantity) {
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty < 0) return "pending_fulfillment"
  if (qty <= 0 && requestedQty > 0) return "out_of_stock"
  if (qty >= requestedQty) return "fulfilled"
  if (qty > 0) return "partial"
  return "pending_fulfillment"
}

function buildFulfillmentSummary(items, quantityField) {
  return items.reduce((summary, item) => {
    const requestedQty = Number(item.requested_quantity || 0)
    const quantity = Number(item[quantityField])
    const status = previewLineFulfillmentStatus(requestedQty, quantity)
    summary.total += 1
    if (status === "fulfilled") summary.fulfilled += 1
    if (status === "partial") summary.partial += 1
    if (status === "out_of_stock") summary.outOfStock += 1
    return summary
  }, { total: 0, fulfilled: 0, partial: 0, outOfStock: 0 })
}

function validateQuantityLines(items, quantityField) {
  for (const item of items) {
    const requestedQty = Number(item.requested_quantity || 0)
    const rawValue = item[quantityField]
    if (rawValue === "" || rawValue == null) {
      return `Indica la cantidad para ${item.item_name}.`
    }
    const quantity = Number(rawValue)
    if (!Number.isFinite(quantity)) {
      return `La cantidad para ${item.item_name} no es válida.`
    }
    if (quantity < 0) {
      return `La cantidad para ${item.item_name} no puede ser negativa.`
    }
    if (quantity > requestedQty) {
      return `La cantidad para ${item.item_name} no puede superar lo solicitado (${formatNumber(requestedQty)}).`
    }
    const pendingQty = Math.max(requestedQty - quantity, 0)
    if (pendingQty > 0 && !item.shortageReason) {
      return `Selecciona el motivo del faltante para ${item.item_name}.`
    }
  }
  return ""
}

function formatShortageReason(reason, notes) {
  if (!reason) return "—"
  const label = SHORTAGE_REASONS.find((entry) => entry.value === reason)?.label || reason
  return notes ? `${label}. ${notes}` : label
}

function Field({ label, children }) {
  return <label className="requisition-field"><span>{label}</span>{children}</label>
}

function canDeleteClosedRequisition(request, user, isElevated) {
  if (!request || !["rejected", "cancelled"].includes(request.status)) return false
  return isElevated || String(request.requested_by) === String(user?.id)
}

function StatusBadge({ status }) {
  return <span className={`req-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>
}

function PriorityBadge({ priority }) {
  return <span className={`req-badge priority-${priority}`}>{PRIORITY_LABELS[priority] || priority}</span>
}

function areaName(areas, areaId) {
  return areas.find((area) => area.id === areaId)?.name || areaId || "Sin área"
}

function stockOf(item, areaId) {
  return Number(item?.stockByArea?.[areaId] || 0)
}

function minimumOf(item, areaId) {
  return Number(item?.minimumByArea?.[areaId] || 0)
}

function normalizeUnit(unit) {
  return normalizeInventoryUnit(unit)
}

function unitLabel(unit) {
  return UNIT_LABELS[normalizeUnit(unit)] || unit || "Unidad"
}

function calculateAvailability(item, areaId, requestedQuantity, requestedUnit, conversions, historical = null) {
  const available = stockOf(item, areaId)
  const minimum = minimumOf(item, areaId)
  const quantity = Number(requestedQuantity || 0)
  const unit = requestedUnit || getDefaultRequisitionUnit(item) || item?.base_unit || ""
  const storedFactor = Number(historical?.storedConversionFactor)
  if (Number.isFinite(storedFactor) && storedFactor > 0) {
    const requestedBase = quantity * storedFactor
    const shortage = Math.max(0, requestedBase - available)
    const status = available <= 0 ? "Sin stock" : shortage > 0 ? "Parcial" : "Disponible"
    return {
      available,
      minimum,
      requestedBase,
      shortage,
      status,
      conversionFactor: storedFactor,
      conversionError: ""
    }
  }
  const { factor, error } = resolveItemRequisitionUnitFactor(item, unit, conversions)
  const requestedBase = factor != null ? quantity * factor : 0
  const shortage = Math.max(0, requestedBase - available)
  const status = available <= 0 ? "Sin stock" : shortage > 0 ? "Parcial" : "Disponible"
  return {
    available,
    minimum,
    requestedBase,
    shortage,
    status,
    conversionFactor: factor,
    conversionError: error || (factor == null ? "Unidad no convertible." : "")
  }
}

function readStoredConversionFactor(line) {
  const factor = Number(
    line.conversionFactor
    ?? line.conversion_factor
    ?? line.storedConversionFactor
  )
  return Number.isFinite(factor) && factor > 0 ? factor : null
}

function readStoredConvertedQuantity(line) {
  const converted = Number(
    line.convertedRequestedQuantity
    ?? line.converted_requested_quantity
  )
  return Number.isFinite(converted) && converted > 0 ? converted : null
}

function resolveLineConversionFactor(line, item, conversions) {
  if (line.conversionWarning || line.conversion_warning) {
    return { factor: null, error: "", unit: "" }
  }

  const unit = line.requestedUnit || line.requested_unit || line.unit || getDefaultRequisitionUnit(item)
  const storedFactor = readStoredConversionFactor(line)
  const storedConverted = readStoredConvertedQuantity(line)
  if (storedFactor != null && (storedConverted != null || Number(line.requestedQuantity ?? line.requested_quantity) > 0)) {
    return { factor: storedFactor, error: "", unit }
  }

  const resolved = resolveItemRequisitionUnitFactor(item, unit, conversions)
  return { ...resolved, unit }
}

function getRequisitionConversionBlockReason(items, inventory, conversions) {
  for (const line of items) {
    if (line.conversionWarning || line.conversion_warning) continue
    const item = inventory.find((entry) => entry.id === (line.itemId || line.item_id))
    const itemName = item?.name || line.item_name || "un producto"
    if (!item) {
      return `No se encontró el producto "${itemName}" en el inventario activo. Actualiza la lista o edita el borrador.`
    }
    const { factor, error, unit } = resolveLineConversionFactor(line, item, conversions)
    if (factor == null) {
      return error || `La unidad ${unit || "(sin unidad)"} no está configurada para ${itemName}. Corrige la unidad o configura la conversión antes de enviar.`
    }
  }
  return ""
}

function getDraftSubmitBlockReason(request, inventory, conversions) {
  return getRequisitionConversionBlockReason(request.items || [], inventory, conversions)
}

function validateRequisitionConversions(items, inventory, conversions) {
  return getRequisitionConversionBlockReason(items, inventory, conversions)
}

function enrichRequestItems(items, inventory, fromAreaId, conversions) {
  return items.map((line) => {
    const item = inventory.find((entry) => entry.id === line.itemId || entry.id === line.item_id)
    const requestedUnit = line.requestedUnit || line.requested_unit || getDefaultRequisitionUnit(item) || line.unit
    const availability = calculateAvailability(
      item,
      fromAreaId,
      line.requestedQuantity ?? line.requested_quantity,
      requestedUnit,
      conversions,
      readStoredConversionFactor(line)
        ? {
          storedConversionFactor: readStoredConversionFactor(line),
          convertedRequestedQuantity: readStoredConvertedQuantity(line)
        }
        : null
    )
    return {
      ...line,
      requestedUnit,
      conversionFactor: availability.conversionFactor,
      convertedRequestedQuantity: availability.requestedBase,
      availabilityStatus: availability.status,
      stockAvailableAtRequest: availability.available,
      stockMinimumAtRequest: availability.minimum,
      conversionWarning: Boolean(availability.conversionError)
    }
  })
}

function AvailabilityBadge({ status }) {
  const normalized = status || "Disponible"
  return <span className={`availability-badge availability-${normalizeSearch(normalized).replace(/\s+/g, "-")}`}>{normalized}</span>
}

function formatNumber(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

function countStatus(requests, status) {
  return status === "all" ? requests.length : requests.filter((request) => request.status === status).length
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString("es-GT") : "-"
}

function readLegacyRequests() {
  try {
    const value = JSON.parse(localStorage.getItem("requisiciones") || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function validateRequestLegacy(request, inventory, areas) {
  if (!request.fromAreaId || !request.toAreaId || request.fromAreaId === request.toAreaId) return "Origen y destino deben ser áreas diferentes."
  if (!areas.some((area) => area.id === request.toAreaId && area.active)) return "El área destino no está activa."
  if (!request.items.length) return "Agrega al menos un producto."
  for (const line of request.items) {
    if (!inventory.some((item) => item.id === line.itemId && item.active)) return "La requisición contiene un producto inactivo."
    if (Number(line.requestedQuantity) <= 0) return "Cada cantidad solicitada debe ser mayor que cero."
  }
  return ""
}

function validateRequest(request, inventory, areas) {
  if (!request.requestedByProfileId) return "Selecciona quién está haciendo la requisición."
  if (!request.fromAreaId || !request.toAreaId || request.fromAreaId === request.toAreaId) return "Origen y destino deben ser areas diferentes."
  if (!areas.some((area) => area.id === request.toAreaId && area.active)) return "El area destino no esta activa."
  if (!request.items.length) return "Agrega al menos un producto."
  for (const line of request.items) {
    const item = inventory.find((entry) => entry.id === line.itemId && entry.active)
    if (!item) return "La requisición contiene un producto inactivo."
    if (Number(line.requestedQuantity) <= 0) return "Cada cantidad solicitada debe ser mayor que cero."
  }
  return ""
}

async function getAuthorizedRequesters() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, email, role, status")
    .eq("status", "active")
    .order("full_name", { ascending: true, nullsFirst: false })
  if (error) return { data: [], error }
  return { data: (data || []).filter((profile) => REQUESTER_ROLES.has(normalizeRole(profile.role))), error: null }
}

function defaultRequesterId(requesters, user) {
  return requesters.find((profile) => String(profile.id) === String(user?.id))?.id || requesters[0]?.id || ""
}

function normalizeAreaName(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function findWarehouseArea(areas) {
  return areas.find((area) => area.id === "almacen")
    || areas.find((area) => normalizeAreaName(area.name) === "almacen")
    || areas.find((area) => area.type === "principal" && area.canRequestInventory === false)
    || null
}

function buildOperationalAreaIds(areas, user, productionAreaIds = []) {
  const ids = new Set()
  productionAreaIds.forEach((areaId) => {
    const area = areas.find((item) => item.id === areaId)
    if (area?.canRequestInventory !== false) ids.add(areaId)
  })
  if (user?.areaId) {
    const area = areas.find((item) => item.id === user.areaId)
    if (area?.canRequestInventory !== false) ids.add(user.areaId)
  }
  areas
    .filter((area) => area.responsibleUserId === user?.id && area.canRequestInventory !== false)
    .forEach((area) => ids.add(area.id))
  return [...ids]
}

function areaDisplayLabel(area) {
  if (!area) return "—"
  const icon = AREA_DISPLAY_ICONS[area.id] || ""
  return `${icon ? `${icon} ` : ""}${area.name}`
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function productMatches(item, term) {
  return [item.name, item.category, item.base_unit, item.purchase_unit, item.supplier, item.sku, item.barcode]
    .some((value) => normalizeSearch(value).includes(term))
}

function profileLabel(profile) {
  return `${profile.full_name || profile.username || profile.email || "Usuario"} - ${profile.role || "sin rol"}`
}

function initials(name) {
  return String(name || "P").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

function requisitionError(error) {
  const message = String(error?.message || error || "").trim()
  const lower = message.toLowerCase()
  if (!message) return "No se pudo completar la requisición. Intenta de nuevo."
  if (lower.includes("selecciona quien")) return "Selecciona quién está haciendo la requisición."
  if (lower.includes("requested_by_profile_id")) {
    return "Faltan columnas de requisiciones en Supabase. Ejecuta supabase/schema/076_requisition_columns_hotfix.sql (o vuelve a aplicar 075 actualizado)."
  }
  if (lower.includes("solo administracion puede crear pruebas")) {
    return "Solo Administración o Gerencia General pueden crear pruebas de flujo."
  }
  if (lower.includes("permiso")) return message
  if (lower.includes("no esta configurada para el producto") || lower.includes("no está configurada para el producto")) {
    return message
  }
  if (lower.includes("area de requisicion asignada")) {
    return "Tu usuario no tiene un área asignada para solicitar inventario. Contacta a administración."
  }
  if (lower.includes("area de almacen activa")) {
    return "No existe un área de Almacén activa. Contacta a administración."
  }
  if (lower.includes("nombre de otro usuario")) return message
  if (lower.includes("jwt") || lower.includes("not authenticated")) return "Tu sesión expiró. Vuelve a iniciar sesión."
  return message
}

export default RequisitionsSupabase
