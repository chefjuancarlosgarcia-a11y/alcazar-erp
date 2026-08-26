import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useBrandingContext } from "../../context/BrandingProvider"
import {
  createCateringQuote,
  getCateringQuoteDetail,
  getCateringQuoteTemplateDetail,
  listCateringQuoteTemplates,
  saveCateringQuoteAsTemplate,
  updateCateringQuote,
  updateCateringQuoteStatus
} from "./cateringService"
import { getCateringQuoteSettings, mergeQuoteSettings } from "./cateringQuoteSettings"
import { repairCateringRequest } from "./cateringTextEncoding"
import { downloadCateringQuotePdf } from "./cateringQuotePdf"
import {
  areQuoteEditorSnapshotsEqual,
  duplicateQuoteItemAtIndex,
  getQuoteEditorSnapshot,
  getSaveValidationError,
  getStatusChangeBlockedReason,
  MOBILE_SECTIONS,
  UNSAVED_CLOSE_MESSAGE
} from "./cateringQuoteModalUtils"
import CateringManualLeadModal from "./CateringManualLeadModal"
import CateringQuotePreview from "./CateringQuotePreview"
import CateringQuoteSettingsPanel from "./CateringQuoteSettingsPanel"
import CateringQuoteTemplateManager from "./CateringQuoteTemplateManager"
import {
  appendTemplateToQuoteItems,
  buildQuotePayload,
  calculateQuoteTotals,
  createEmptyQuoteItem,
  DEFAULT_QUOTE_TERMS,
  formatQuantityLine,
  getLineTotal,
  getQuoteOptionGroupScopeKey,
  groupQuoteItemsForEditor,
  isQuoteOptionLine,
  normalizeQuoteItems,
  QUOTE_ITEM_TYPES,
  QUOTE_LINE_KINDS,
  QUANTITY_UNITS,
  QUOTE_STATUS_LABELS,
  removeQuoteSection,
  templateAlreadyAdded,
  defaultValidUntil
} from "./cateringQuoteTemplates"
import { formatDate, formatMoney, formatProducts, formatTime } from "./cateringUtils"
import { CateringQuoteStatusBadge } from "./CateringQuoteKpis"

const FORM_ID = "catering-quote-form"
const REMOVE_LINE_MESSAGE = "¿Eliminar esta linea de la cotizacion?"

function mapItemsFromApi(items = []) {
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit || "unidades",
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? index + 1,
    line_kind: item.line_kind || "normal",
    option_group_name: item.option_group_name || "",
    option_label: item.option_label || "",
    is_selected_option: Boolean(item.is_selected_option),
    source_template_id: item.source_template_id || null,
    source_template_name: item.source_template_name || "",
    section_name: item.section_name || "",
    section_order: Number(item.section_order) || 0
  }))
}

function renderTotalsSummary(totals) {
  return (
    <div className="catering-quote-totals">
      <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
      {totals.discount_amount > 0 ? (
        <div><span>Descuento</span><strong>-{formatMoney(totals.discount_amount)}</strong></div>
      ) : null}
      <div className="is-total">
        <span>Total</span>
        <strong>
          {totals.has_unresolved_option_groups ? "Según opción elegida" : formatMoney(totals.total)}
        </strong>
      </div>
      {totals.has_unresolved_option_groups ? (
        <small className="catering-quote-preview__option-note">
          El total final depende de la opción de menú seleccionada.
        </small>
      ) : null}
      <small className="catering-quote-preview__vat">Precios incluyen IVA</small>
    </div>
  )
}

function CateringQuoteEditor({
  request,
  quoteId = null,
  profiles = [],
  onClose,
  onSaved,
  onRequestUpdated
}) {
  const branding = useBrandingContext()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [currentQuoteId, setCurrentQuoteId] = useState(quoteId)
  const [quote, setQuote] = useState(null)
  const [items, setItems] = useState([createEmptyQuoteItem()])
  const [discountAmount, setDiscountAmount] = useState("0")
  const [validUntil, setValidUntil] = useState(defaultValidUntil())
  const [notes, setNotes] = useState("")
  const [terms, setTerms] = useState(DEFAULT_QUOTE_TERMS)
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [companySettings, setCompanySettings] = useState(null)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showEditLead, setShowEditLead] = useState(false)
  const [displayRequest, setDisplayRequest] = useState(request || {})
  const [mobileSection, setMobileSection] = useState("datos")
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false)
  const [cleanSnapshot, setCleanSnapshot] = useState(null)

  const sectionRefs = {
    datos: useRef(null),
    productos: useRef(null),
    cierre: useRef(null)
  }
  const previewCloseRef = useRef(null)
  const previewTriggerRef = useRef(null)
  const mobileMoreActionsRef = useRef(null)

  const totals = useMemo(() => calculateQuoteTotals(items, discountAmount), [items, discountAmount])
  const editorGroups = useMemo(() => groupQuoteItemsForEditor(items), [items])
  const safeRequest = useMemo(() => repairCateringRequest(displayRequest || {}), [displayRequest])
  const company = useMemo(
    () => mergeQuoteSettings(companySettings || {}, branding),
    [companySettings, branding]
  )

  const currentSnapshot = useMemo(
    () => getQuoteEditorSnapshot({ items, discountAmount, validUntil, notes, terms }),
    [items, discountAmount, validUntil, notes, terms]
  )

  const editorReady = cleanSnapshot != null

  const isDirty = useMemo(
    () => editorReady && !areQuoteEditorSnapshotsEqual(cleanSnapshot, currentSnapshot),
    [editorReady, cleanSnapshot, currentSnapshot]
  )

  const requestClose = useCallback(() => {
    if (editorReady && isDirty && !window.confirm(UNSAVED_CLOSE_MESSAGE)) return
    onClose()
  }, [editorReady, isDirty, onClose])

  const isDraft = !quote?.status || quote.status === "draft"
  const canEdit = isDraft && editorReady

  const markClean = useCallback((snapshotSource) => {
    setCleanSnapshot(getQuoteEditorSnapshot(snapshotSource))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initializeEditor() {
      const [templatesResult, settingsResult] = await Promise.all([
        listCateringQuoteTemplates(false),
        getCateringQuoteSettings()
      ])
      if (cancelled) return

      if (!templatesResult.error) {
        setTemplates(templatesResult.data || [])
      }
      if (!settingsResult.error) {
        setCompanySettings(settingsResult.data)
      }

      if (quoteId) {
        setLoading(true)
        setError("")
        const result = await getCateringQuoteDetail(quoteId)
        if (cancelled) return
        setLoading(false)

        if (result.error) {
          setError(result.error)
          return
        }

        const quoteRow = result.data?.quote || null
        const mappedItems = mapItemsFromApi(result.data?.items)
        const nextItems = mappedItems.length ? mappedItems : [createEmptyQuoteItem()]
        const nextDiscount = String(quoteRow?.discount_amount ?? 0)
        const nextValidUntil = quoteRow?.valid_until
          ? String(quoteRow.valid_until).slice(0, 10)
          : defaultValidUntil()
        const nextNotes = quoteRow?.notes || ""
        const nextTerms = quoteRow?.terms || settingsResult.data?.defaultTerms || DEFAULT_QUOTE_TERMS

        setQuote(quoteRow)
        setItems(nextItems)
        setDiscountAmount(nextDiscount)
        setValidUntil(nextValidUntil)
        setNotes(nextNotes)
        setTerms(nextTerms)
        markClean({
          items: nextItems,
          discountAmount: nextDiscount,
          validUntil: nextValidUntil,
          notes: nextNotes,
          terms: nextTerms
        })
        return
      }

      const nextTerms = settingsResult.error
        ? DEFAULT_QUOTE_TERMS
        : (settingsResult.data?.defaultTerms || DEFAULT_QUOTE_TERMS)
      const nextValidUntil = defaultValidUntil()
      if (!settingsResult.error) {
        setTerms(nextTerms)
      }
      markClean({
        items: [createEmptyQuoteItem()],
        discountAmount: "0",
        validUntil: nextValidUntil,
        notes: "",
        terms: nextTerms
      })
    }

    initializeEditor()
    return () => {
      cancelled = true
    }
  }, [quoteId, markClean])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return
      if (mobilePreviewOpen) {
        event.preventDefault()
        closeMobilePreview()
        return
      }
      event.preventDefault()
      requestClose()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [mobilePreviewOpen, requestClose])

  useEffect(() => {
    if (mobilePreviewOpen) {
      previewCloseRef.current?.focus()
      return undefined
    }

    const trigger = previewTriggerRef.current
    if (trigger instanceof HTMLElement && document.contains(trigger)) {
      trigger.focus()
    }
    return undefined
  }, [mobilePreviewOpen])

  function closeMobileMoreActions() {
    if (mobileMoreActionsRef.current) {
      mobileMoreActionsRef.current.open = false
    }
  }

  function focusSection(sectionId) {
    if (!MOBILE_SECTIONS.some((section) => section.id === sectionId)) return

    setMobileSection(sectionId)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const sectionNode = sectionRefs[sectionId]?.current
        sectionNode?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    })
  }

  async function reloadTemplates() {
    const templatesResult = await listCateringQuoteTemplates(false)
    if (!templatesResult.error) {
      setTemplates(templatesResult.data || [])
    }
  }

  async function handleAddTemplate() {
    if (!selectedTemplate) {
      setError("Selecciona una plantilla para agregar.")
      focusSection("productos")
      return
    }

    const template = templates.find((entry) => entry.id === selectedTemplate)
    const templateName = template?.name || "Plantilla"
    const isDuplicate = templateAlreadyAdded(items, selectedTemplate)
    const confirmed = window.confirm(
      isDuplicate
        ? "Esta plantilla ya fue agregada. ¿Deseas agregarla otra vez?"
        : "¿Deseas agregar las lineas de esta plantilla a la cotización actual?"
    )
    if (!confirmed) return

    const result = await getCateringQuoteTemplateDetail(selectedTemplate)
    if (result.error) {
      setError(result.error)
      focusSection("productos")
      return
    }

    setItems((current) => appendTemplateToQuoteItems(current, result.data?.items || [], {
      source_template_id: selectedTemplate,
      source_template_name: templateName,
      section_name: templateName
    }))
    setSelectedTemplate("")
    setMessage(`Plantilla "${templateName}" agregada a la cotización.`)
    setError("")
    focusSection("productos")
  }

  function updateItem(index, field, value) {
    setItems((current) => {
      let next = current.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ))

      if (field === "line_kind" && value === "normal") {
        next[index] = {
          ...next[index],
          option_group_name: "",
          option_label: "",
          is_selected_option: false
        }
      }

      if (field === "is_selected_option" && value) {
        const scopeKey = getQuoteOptionGroupScopeKey(next[index])
        if (scopeKey) {
          next = next.map((item, itemIndex) => {
            if (itemIndex === index) return item
            if (isQuoteOptionLine(item) && getQuoteOptionGroupScopeKey(item) === scopeKey) {
              return { ...item, is_selected_option: false }
            }
            return item
          })
        }
      }

      return next
    })
  }

  function addItem() {
    setItems((current) => [...current, createEmptyQuoteItem(current.length + 1)])
    focusSection("productos")
  }

  function duplicateItem(index) {
    setItems((current) => duplicateQuoteItemAtIndex(current, index))
    focusSection("productos")
  }

  function removeItem(index) {
    if (!window.confirm(REMOVE_LINE_MESSAGE)) return
    setItems((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length ? next : [createEmptyQuoteItem()]
    })
  }

  function removeTemplateSectionGroup(sectionKey, sectionName) {
    const confirmed = window.confirm(`¿Quitar la sección "${sectionName}" y todas sus líneas?`)
    if (!confirmed) return
    setItems((current) => removeQuoteSection(current, sectionKey))
    setMessage(`Sección "${sectionName}" eliminada.`)
  }

  function renderLineCard(item, index) {
    const lineTotal = getLineTotal(item)
    const isOption = isQuoteOptionLine(item)
    const countsTowardTotal = !isOption || item.is_selected_option

    return (
      <article
        key={`${index}-${item.sort_order}-${item.description}`}
        className={`catering-quote-line-card${isOption ? " catering-quote-line-card--option" : ""}`}
      >
        <div className="catering-quote-line-card__top">
          <strong>Producto {index + 1}{isOption ? " · Opción" : ""}</strong>
          {canEdit ? (
            <div className="catering-quote-line-card__actions">
              <button
                type="button"
                className="ghost catering-quote-line-card__duplicate"
                onClick={() => duplicateItem(index)}
                aria-label={`Duplicar producto ${index + 1}`}
              >
                Duplicar
              </button>
              <button
                type="button"
                className="ghost catering-quote-line-card__remove"
                onClick={() => removeItem(index)}
                aria-label={`Eliminar producto ${index + 1}`}
              >
                Eliminar
              </button>
            </div>
          ) : null}
        </div>

        <label className="catering-quote-line-card__description">
          <span>Descripcion</span>
          <input
            type="text"
            value={item.description}
            disabled={!canEdit}
            placeholder="Descripcion del servicio o producto"
            onChange={(e) => updateItem(index, "description", e.target.value)}
          />
        </label>

        <div className="catering-quote-line-card__grid catering-quote-line-card__grid--primary">
          <label>
            <span>Cantidad</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.quantity}
              disabled={!canEdit}
              onChange={(e) => updateItem(index, "quantity", e.target.value)}
            />
          </label>
          <label>
            <span>Precio unit. (Q)</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.unit_price}
              disabled={!canEdit}
              onChange={(e) => updateItem(index, "unit_price", e.target.value)}
            />
          </label>
          <label>
            <span>Unidad</span>
            <select
              value={item.quantity_unit}
              disabled={!canEdit}
              onChange={(e) => updateItem(index, "quantity_unit", e.target.value)}
            >
              {QUANTITY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
            </select>
          </label>
        </div>

        <details className="catering-quote-line-card__advanced">
          <summary>Opciones avanzadas</summary>
          <label className="catering-quote-line-card__kind">
            <span>Tipo de linea</span>
            <select
              value={item.line_kind || "normal"}
              disabled={!canEdit}
              onChange={(e) => updateItem(index, "line_kind", e.target.value)}
            >
              {QUOTE_LINE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </select>
          </label>
          <label>
            <span>Categoria</span>
            <select
              value={item.item_type}
              disabled={!canEdit}
              onChange={(e) => updateItem(index, "item_type", e.target.value)}
            >
              {QUOTE_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          {isOption ? (
            <div className="catering-quote-line-card__option-fields">
              <label>
                <span>Nombre del grupo</span>
                <input
                  type="text"
                  value={item.option_group_name || ""}
                  disabled={!canEdit}
                  placeholder="Ej. Platillos formales"
                  onChange={(e) => updateItem(index, "option_group_name", e.target.value)}
                />
              </label>
              <label>
                <span>Nombre de opcion</span>
                <input
                  type="text"
                  value={item.option_label || ""}
                  disabled={!canEdit}
                  placeholder="Ej. Opcion Res"
                  onChange={(e) => updateItem(index, "option_label", e.target.value)}
                />
              </label>
              <label className="catering-quote-line-card__selected">
                <input
                  type="checkbox"
                  checked={Boolean(item.is_selected_option)}
                  disabled={!canEdit}
                  onChange={(e) => updateItem(index, "is_selected_option", e.target.checked)}
                />
                <span>Opcion seleccionada</span>
              </label>
            </div>
          ) : null}
        </details>

        <div className="catering-quote-line-card__total">
          <span>{countsTowardTotal ? "Total linea" : "Referencia (no suma al total)"}</span>
          <div>
            <strong>{formatMoney(lineTotal)}</strong>
            <small>{formatQuantityLine(item)}</small>
          </div>
        </div>
      </article>
    )
  }

  function handleLeadUpdated({ request: updatedRequest }) {
    setDisplayRequest(updatedRequest)
    setShowEditLead(false)
    setMessage("Datos del lead actualizados.")
    onRequestUpdated?.(updatedRequest)
  }

  async function handleSave(event) {
    event?.preventDefault?.()

    const validationError = getSaveValidationError(items)
    if (validationError) {
      setError(validationError.message)
      focusSection(validationError.section)
      return
    }

    const payload = buildQuotePayload(items, discountAmount, validUntil, notes, terms)

    setSaving(true)
    setError("")
    setMessage("")
    const result = currentQuoteId
      ? await updateCateringQuote(currentQuoteId, payload)
      : await createCateringQuote(displayRequest.id, payload)

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }

    const savedQuote = result.data?.quote
    const savedItems = mapItemsFromApi(result.data?.items)
    setQuote(savedQuote)
    setCurrentQuoteId(savedQuote?.id || currentQuoteId)
    setItems(savedItems)
    markClean({
      items: savedItems,
      discountAmount: String(savedQuote?.discount_amount ?? discountAmount),
      validUntil: savedQuote?.valid_until ? String(savedQuote.valid_until).slice(0, 10) : validUntil,
      notes: savedQuote?.notes ?? notes,
      terms: savedQuote?.terms ?? terms
    })
    setMessage(currentQuoteId ? "Cotización actualizada." : "Cotización creada en borrador.")
    onSaved?.(result.data)
  }

  async function handleStatusChange(status) {
    const blockedReason = getStatusChangeBlockedReason({ isDirty, currentQuoteId })
    if (blockedReason) {
      setError(blockedReason)
      setMessage("")
      return
    }
    setSaving(true)
    setError("")
    setMessage("")
    const result = await updateCateringQuoteStatus(currentQuoteId, status)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const savedQuote = result.data?.quote || null
    setQuote(savedQuote)
    markClean({
      items,
      discountAmount,
      validUntil,
      notes,
      terms
    })
    closeMobileMoreActions()
    setMessage(`Cotización marcada como ${QUOTE_STATUS_LABELS[status] || status}.`)
    onSaved?.(result.data)
  }

  async function handleSaveAsTemplate() {
    if (!currentQuoteId) {
      setError("Guarda la cotizacion antes de crear una plantilla.")
      return
    }
    const name = window.prompt("Nombre de la plantilla:")
    if (!name?.trim()) return
    const result = await saveCateringQuoteAsTemplate(currentQuoteId, { name: name.trim(), category: "personalizada" })
    if (result.error) setError(result.error)
    else {
      closeMobileMoreActions()
      setMessage("Plantilla guardada.")
      reloadTemplates()
    }
  }

  function handleGeneratePdf() {
    closeMobileMoreActions()
    const quoteRow = {
      ...(quote || {}),
      quote_number: quote?.quote_number || "BORRADOR",
      status: quote?.status || "draft",
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_amount: 0,
      total: totals.total,
      valid_until: validUntil,
      notes,
      terms
    }
    downloadCateringQuotePdf({
      quote: quoteRow,
      items: normalizeQuoteItems(items).map((item) => ({
        ...item,
        total_price: item.quantity * item.unit_price
      })),
      request: safeRequest,
      company,
      branding
    })
  }

  function openMobilePreview(event) {
    if (event?.currentTarget instanceof HTMLElement) {
      previewTriggerRef.current = event.currentTarget
    }
    setMobilePreviewOpen(true)
  }

  function closeMobilePreview() {
    setMobilePreviewOpen(false)
  }

  const previewProps = {
    quoteNumber: quote?.quote_number,
    quoteStatus: quote?.status || "draft",
    request: safeRequest,
    items,
    discountAmount,
    validUntil,
    notes,
    terms,
    company
  }

  return (
    <>
      <div className="catering-quote-backdrop" onClick={requestClose}>
        <section
          className="catering-quote-modal catering-quote-modal--split"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catering-quote-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="catering-quote-modal__header">
            <div>
              <p>Cotización de catering</p>
              <h2 id="catering-quote-title">{quote?.quote_number || "Nueva cotizacion"}</h2>
              <span>{safeRequest?.customer_name || "Cliente"}</span>
            </div>
            <div className="catering-quote-modal__badges">
              {quote?.status ? <CateringQuoteStatusBadge status={quote.status} label={QUOTE_STATUS_LABELS[quote.status]} /> : null}
              {isDirty ? <span className="catering-quote-dirty-badge">Sin guardar</span> : null}
              <button type="button" className="ghost catering-quote-modal__close" onClick={requestClose}>
                Cerrar
              </button>
            </div>
          </header>

          {loading || !editorReady ? (
            <p className="catering-empty">{loading ? "Cargando cotizacion..." : error || "Preparando editor..."}</p>
          ) : (
            <div className="catering-quote-modal__split">
              <form
                id={FORM_ID}
                className="catering-quote-modal__body catering-quote-editor"
                onSubmit={handleSave}
              >
                <nav className="catering-quote-mobile-stepper" aria-label="Secciones de cotizacion">
                  {MOBILE_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={mobileSection === section.id ? "is-active" : ""}
                      aria-current={mobileSection === section.id ? "step" : undefined}
                      onClick={() => setMobileSection(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </nav>

                <div className="catering-quote-editor__panels">
                  <div
                    ref={sectionRefs.datos}
                    className={`catering-quote-mobile-panel${mobileSection === "datos" ? " is-active" : ""}`}
                    data-mobile-section="datos"
                  >
                    <div className="catering-quote-top-bar">
                      <section className="catering-quote-section catering-quote-context" aria-labelledby="catering-quote-client">
                        <div className="catering-quote-section__head">
                          <h3 id="catering-quote-client">Cliente y evento</h3>
                          {canEdit ? (
                            <button type="button" className="ghost catering-quote-edit-lead" onClick={() => setShowEditLead(true)}>
                              Editar lead
                            </button>
                          ) : null}
                        </div>
                        <dl className="catering-quote-context-grid">
                          <div>
                            <dt>Cliente</dt>
                            <dd>{safeRequest.customer_name || "—"}</dd>
                          </div>
                          <div>
                            <dt>Contacto</dt>
                            <dd>{safeRequest.customer_phone || safeRequest.customer_email || "—"}</dd>
                          </div>
                          <div>
                            <dt>Evento</dt>
                            <dd>{safeRequest.event_type || "—"}</dd>
                          </div>
                          <div>
                            <dt>Fecha</dt>
                            <dd>
                              {formatDate(safeRequest.event_date)}
                              {safeRequest.event_time ? ` ${formatTime(safeRequest.event_time)}` : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Ubicacion</dt>
                            <dd>{safeRequest.event_location || "—"}</dd>
                          </div>
                          <div className="catering-quote-context-grid__wide">
                            <dt>Productos solicitados</dt>
                            <dd>{formatProducts(safeRequest.products_requested)}</dd>
                          </div>
                        </dl>
                      </section>

                      <section className="catering-quote-section catering-quote-summary-card catering-quote-summary-card--inline" aria-labelledby="catering-quote-summary">
                        <h3 id="catering-quote-summary">Resumen</h3>
                        {renderTotalsSummary(totals)}
                      </section>
                    </div>

                    <section className="catering-quote-section" aria-labelledby="catering-quote-validity">
                      <h3 id="catering-quote-validity">Vigencia</h3>
                      <label className="catering-quote-field">
                        <span>Fecha de vigencia</span>
                        <input
                          type="date"
                          value={validUntil}
                          disabled={!canEdit}
                          onChange={(e) => setValidUntil(e.target.value)}
                        />
                      </label>
                    </section>
                  </div>

                  <div
                    ref={sectionRefs.productos}
                    className={`catering-quote-mobile-panel${mobileSection === "productos" ? " is-active" : ""}`}
                    data-mobile-section="productos"
                  >
                    <section className="catering-quote-section" aria-labelledby="catering-quote-general">
                      <h3 id="catering-quote-general">Plantillas</h3>
                      <div className="catering-quote-toolbar">
                        <label className="catering-quote-toolbar__template">
                          Plantilla
                          <select value={selectedTemplate} disabled={!canEdit} onChange={(e) => setSelectedTemplate(e.target.value)}>
                            <option value="">Seleccionar plantilla</option>
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>{template.name}</option>
                            ))}
                          </select>
                        </label>
                        {canEdit ? (
                          <button type="button" className="ghost catering-quote-toolbar__add-template" onClick={handleAddTemplate}>
                            + Agregar plantilla
                          </button>
                        ) : null}
                        <div className="catering-quote-toolbar__actions">
                          <button type="button" className="ghost" onClick={() => setShowTemplateManager(true)}>Gestionar plantillas</button>
                          <button type="button" className="ghost" onClick={() => setShowSettings(true)}>Datos empresa</button>
                        </div>
                      </div>
                    </section>

                    <section className="catering-quote-section catering-quote-section--items" aria-labelledby="catering-quote-items">
                      <div className="catering-quote-section__head">
                        <h3 id="catering-quote-items">Productos</h3>
                        {canEdit ? (
                          <button type="button" className="ghost catering-quote-section__add" onClick={addItem}>
                            + Agregar producto
                          </button>
                        ) : null}
                      </div>
                      <div className="catering-quote-lines-stack">
                        {editorGroups.map((group) => {
                          if (group.type === "template_section") {
                            return (
                              <section key={group.sectionKey} className="catering-quote-template-section">
                                <div className="catering-quote-template-section__head">
                                  <div>
                                    <span className="catering-quote-template-section__label">Plantilla</span>
                                    <strong>{group.sectionName}</strong>
                                  </div>
                                  {canEdit ? (
                                    <button
                                      type="button"
                                      className="ghost catering-quote-template-section__remove"
                                      onClick={() => removeTemplateSectionGroup(group.sectionKey, group.sectionName)}
                                    >
                                      Quitar sección
                                    </button>
                                  ) : null}
                                </div>
                                <div className="catering-quote-template-section__lines">
                                  {group.lines.map(({ item, index }) => renderLineCard(item, index))}
                                </div>
                              </section>
                            )
                          }

                          return group.lines.map(({ item, index }) => renderLineCard(item, index))
                        })}
                      </div>
                    </section>
                  </div>

                  <div
                    ref={sectionRefs.cierre}
                    className={`catering-quote-mobile-panel${mobileSection === "cierre" ? " is-active" : ""}`}
                    data-mobile-section="cierre"
                  >
                    <section className="catering-quote-section catering-quote-summary-card catering-quote-summary-card--mobile" aria-labelledby="catering-quote-summary-mobile">
                      <h3 id="catering-quote-summary-mobile">Resumen de totales</h3>
                      {renderTotalsSummary(totals)}
                    </section>

                    <section className="catering-quote-section" aria-labelledby="catering-quote-discount">
                      <h3 id="catering-quote-discount">Descuento</h3>
                      <label className="catering-quote-field">
                        <span>Descuento (Q)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={discountAmount}
                          disabled={!canEdit}
                          onChange={(e) => setDiscountAmount(e.target.value)}
                        />
                      </label>
                    </section>

                    <section className="catering-quote-section" aria-labelledby="catering-quote-notes">
                      <h3 id="catering-quote-notes">Notas y terminos</h3>
                      <label className="catering-quote-field">
                        Notas comerciales
                        <textarea rows={3} value={notes} disabled={!canEdit} placeholder="Mensaje comercial para el cliente" onChange={(e) => setNotes(e.target.value)} />
                      </label>
                      <label className="catering-quote-field">
                        Terminos y condiciones
                        <textarea rows={6} value={terms} disabled={!canEdit} onChange={(e) => setTerms(e.target.value)} />
                      </label>
                    </section>

                    {message ? <p className="catering-message success">{message}</p> : null}
                    {error ? <p className="catering-message error" role="alert">{error}</p> : null}
                  </div>
                </div>

                <footer className="catering-quote-modal__footer catering-quote-actions catering-quote-actions--desktop">
                  <div className="catering-quote-actions__group catering-quote-actions__group--secondary">
                    <button type="button" className="ghost" onClick={handleGeneratePdf}>Generar PDF</button>
                    {currentQuoteId ? (
                      <button type="button" className="ghost" disabled={saving} onClick={handleSaveAsTemplate}>Guardar como plantilla</button>
                    ) : null}
                    {quote?.status === "sent" ? (
                      <>
                        <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("rejected")}>Cliente rechazo</button>
                        <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("expired")}>Marcar vencida</button>
                      </>
                    ) : null}
                  </div>
                  <div className="catering-quote-actions__group catering-quote-actions__group--primary">
                    {canEdit ? (
                      <button type="submit" className="primary" disabled={saving}>
                        {saving ? "Guardando..." : currentQuoteId ? "Guardar borrador" : "Crear cotizacion"}
                      </button>
                    ) : null}
                    {currentQuoteId && quote?.status === "draft" ? (
                      <button type="button" className="primary" disabled={saving || isDirty} onClick={() => handleStatusChange("sent")}>Marcar enviada</button>
                    ) : null}
                    {quote?.status === "sent" ? (
                      <button type="button" className="primary" disabled={saving || isDirty} onClick={() => handleStatusChange("approved")}>Cliente aprobo</button>
                    ) : null}
                  </div>
                </footer>

                <div className="catering-quote-mobile-bar" role="toolbar" aria-label="Acciones principales de cotizacion">
                  <button
                    type="submit"
                    form={FORM_ID}
                    className="primary catering-quote-mobile-bar__primary"
                    disabled={saving || !canEdit}
                  >
                    {saving ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    className="ghost catering-quote-mobile-bar__preview"
                    onClick={openMobilePreview}
                  >
                    Vista previa
                  </button>
                  <details ref={mobileMoreActionsRef} className="catering-quote-mobile-bar__more">
                    <summary>Más acciones</summary>
                    <div className="catering-quote-mobile-bar__menu">
                      <button type="button" className="ghost" onClick={handleGeneratePdf}>Generar PDF</button>
                      {currentQuoteId ? (
                        <button type="button" className="ghost" disabled={saving} onClick={handleSaveAsTemplate}>Guardar como plantilla</button>
                      ) : null}
                      {currentQuoteId && quote?.status === "draft" ? (
                        <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("sent")}>Marcar enviada</button>
                      ) : null}
                      {quote?.status === "sent" ? (
                        <>
                          <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("approved")}>Cliente aprobo</button>
                          <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("rejected")}>Cliente rechazo</button>
                          <button type="button" className="ghost" disabled={saving || isDirty} onClick={() => handleStatusChange("expired")}>Marcar vencida</button>
                        </>
                      ) : null}
                    </div>
                  </details>
                </div>
              </form>

              <div className="catering-quote-modal__preview-wrap catering-quote-modal__preview-wrap--desktop">
                <CateringQuotePreview {...previewProps} />
              </div>
            </div>
          )}
        </section>
      </div>

      {mobilePreviewOpen ? (
        <div
          className="catering-quote-mobile-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de cotizacion"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="catering-quote-mobile-preview__header">
            <button
              ref={previewCloseRef}
              type="button"
              className="ghost catering-quote-mobile-preview__back"
              onClick={closeMobilePreview}
            >
              Volver al editor
            </button>
          </header>
          <div className="catering-quote-mobile-preview__body">
            <CateringQuotePreview {...previewProps} />
          </div>
        </div>
      ) : null}

      <CateringQuoteTemplateManager
        open={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
        onTemplatesChanged={reloadTemplates}
      />
      <CateringQuoteSettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={(data) => {
          setCompanySettings(data)
          if (!terms || terms === DEFAULT_QUOTE_TERMS) setTerms(data.defaultTerms || DEFAULT_QUOTE_TERMS)
        }}
      />
      <CateringManualLeadModal
        open={showEditLead}
        request={displayRequest}
        profiles={profiles}
        nested
        onClose={() => setShowEditLead(false)}
        onSaved={handleLeadUpdated}
      />
    </>
  )
}

export default function CateringQuoteModal({
  open,
  request,
  quoteId = null,
  profiles = [],
  onClose,
  onSaved,
  onRequestUpdated
}) {
  const [sessionKey, setSessionKey] = useState(0)
  const [prevSession, setPrevSession] = useState({
    open: false,
    quoteId: null,
    requestId: null
  })

  const requestId = request?.id ?? null

  if (
    open !== prevSession.open
    || (open && (quoteId !== prevSession.quoteId || requestId !== prevSession.requestId))
  ) {
    setPrevSession({
      open,
      quoteId: open ? quoteId : null,
      requestId: open ? requestId : null
    })
    if (open) {
      setSessionKey((key) => key + 1)
    }
  }

  if (!open) return null

  return (
    <CateringQuoteEditor
      key={sessionKey}
      request={request}
      quoteId={quoteId}
      profiles={profiles}
      onClose={onClose}
      onSaved={onSaved}
      onRequestUpdated={onRequestUpdated}
    />
  )
}
