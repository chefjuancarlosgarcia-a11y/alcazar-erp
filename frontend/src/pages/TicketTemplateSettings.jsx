import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import {
  DEFAULT_TICKET_SETTINGS,
  TICKET_TEMPLATE_TYPES,
  defaultTicketTemplate,
  listTicketTemplates,
  normalizeTicketTemplate,
  saveTicketTemplate,
  uploadTicketAsset
} from "../services/ticketTemplatesService"
import { renderTicketHtml } from "../services/ticketRenderer"
import "../styles/TicketTemplateSettings.css"

const PAPER_WIDTHS = [
  ["80mm", "80mm"],
  ["58mm", "58mm"],
  ["letter", "Carta/PDF"]
]

const FONT_SIZES = [["small", "Pequena"], ["medium", "Mediana"], ["large", "Grande"]]
const FONT_FAMILIES = [["monospace", "Monospace"], ["sans-serif", "Sans-serif"]]
const ALIGNMENTS = [["center", "Centro"], ["left", "Izquierda"]]
const DIVIDERS = [["dashed", "Dashed"], ["solid", "Solid"], ["dotted", "Dotted"]]
const LOGO_SIZES = [["small", "Pequeno"], ["medium", "Mediano"], ["large", "Grande"]]
const QR_TYPES = [["vip", "Club VIP"], ["reviews", "Google Reviews"], ["menu", "Menu"], ["instagram", "Instagram"], ["website", "Website"], ["custom", "Personalizado"]]
const BLOCK_LABELS = {
  showHeader: "Mostrar encabezado",
  showBusiness: "Mostrar datos del negocio",
  showOrderInfo: "Mostrar datos de orden",
  showCustomer: "Mostrar datos de cliente",
  showProducts: "Mostrar productos",
  showTotals: "Mostrar totales",
  showMessages: "Mostrar mensajes",
  showCoupon: "Mostrar cupon",
  showQr: "Mostrar QR",
  showFinalText: "Mostrar corte / texto final"
}

const PREVIEW_DEFAULTS = {
  customerName: "Juan Carlos Garcia",
  customerPhone: "5555-5555",
  deliveryAddress: "4ta avenida 2-74 zona 9, Colonia La Floresta, Quetzaltenango",
  deliveryReference: "Casa azul, frente al porton negro",
  mapsLink: "https://maps.google.com/?q=El+Gran+Alcazar",
  paymentMethod: "cash",
  salesChannel: "delivery",
  tableName: "Delivery - Juan Carlos Garcia",
  waiterName: "Juan Carlos",
  cashierName: "Juan Carlos",
  productName: "Prueba de Platillo KDS",
  price: "100",
  quantity: "1",
  itemNote: "Sin cebolla"
}

const QUICK_MODES = {
  minimal: {
    label: "Minimalista",
    blocks: { showHeader: true, showBusiness: true, showOrderInfo: true, showCustomer: false, showProducts: true, showTotals: true, showMessages: false, showCoupon: false, showQr: false, showFinalText: true },
    business: { showLogo: false },
    orderInfo: { showOrderId: true, showDate: false, showCashier: false, showWaiter: false, showTable: false, showSalesChannel: false, showPaymentMethod: false },
    totals: { showSubtotal: false, showDiscounts: false, showTax: false, showServiceCharge: false, showTipSuggestion: false, showTotal: true }
  },
  standard: {
    label: "Estandar",
    blocks: { showHeader: true, showBusiness: true, showOrderInfo: true, showCustomer: false, showProducts: true, showTotals: true, showMessages: false, showCoupon: false, showQr: false, showFinalText: true }
  },
  complete: {
    label: "Completo",
    blocks: { showHeader: true, showBusiness: true, showOrderInfo: true, showCustomer: false, showProducts: true, showTotals: true, showMessages: true, showCoupon: false, showQr: false, showFinalText: true }
  },
  delivery: {
    label: "Delivery completo",
    blocks: { showHeader: true, showBusiness: true, showOrderInfo: true, showCustomer: true, showProducts: true, showTotals: true, showMessages: true, showCoupon: false, showQr: false, showFinalText: true }
  },
  marketing: {
    label: "Marketing / VIP",
    blocks: { showHeader: true, showBusiness: true, showOrderInfo: false, showCustomer: false, showProducts: true, showTotals: true, showMessages: true, showCoupon: true, showQr: true, showFinalText: true },
    coupon: { enabled: true },
    qr: { enabled: true }
  }
}

function roleKey(role) {
  return String(role || "").toLowerCase()
}

function buildPreviewOrder(data) {
  const quantity = Number(data.quantity || 1)
  const price = Number(data.price || 0)
  return {
    id: "prebill-1780787058136-63518",
    tableName: data.tableName,
    waiterName: data.waiterName,
    cashierName: data.cashierName,
    salesChannel: data.salesChannel,
    paymentMethod: data.paymentMethod,
    peopleCount: "1",
    delivery: {
      customerName: data.customerName,
      phone: data.customerPhone,
      address: data.deliveryAddress,
      reference: data.deliveryReference,
      mapsLink: data.mapsLink,
      paymentMethod: data.paymentMethod,
      deliveryNotes: data.itemNote
    },
    items: [
      { nombre: data.productName, cantidad: quantity, precio: price, notes: data.itemNote }
    ],
    subtotal: quantity * price,
    total: quantity * price
  }
}

function getAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object)
}

function setAt(object, path, value) {
  const keys = path.split(".")
  const next = { ...object }
  let cursor = next
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value
    } else {
      cursor[key] = { ...(cursor[key] || {}) }
      cursor = cursor[key]
    }
  })
  return next
}

function TicketTemplateSettings() {
  const { user } = useAuth()
  const canEdit = ["admin", "gerente_general"].includes(roleKey(user?.role))
  const [templates, setTemplates] = useState([])
  const [templateKey, setTemplateKey] = useState("prebill")
  const [template, setTemplate] = useState(defaultTicketTemplate("prebill"))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [previewData, setPreviewData] = useState(PREVIEW_DEFAULTS)

  useEffect(() => {
    loadTemplates()
  }, [])

  useEffect(() => {
    const selected = templates.find((item) => item.template_key === templateKey && item.status === "active" && item.is_default)
      || templates.find((item) => item.template_key === templateKey)
      || defaultTicketTemplate(templateKey)
    setTemplate(normalizeTicketTemplate(selected))
  }, [templateKey, templates])

  const previewOrder = useMemo(() => buildPreviewOrder(previewData), [previewData])
  const previewHtml = useMemo(() => renderTicketHtml(previewOrder, template, template.template_key), [template, previewOrder])

  async function loadTemplates() {
    setLoading(true)
    const result = await listTicketTemplates()
    setTemplates(result.data || [])
    if (result.error) setError("No se pudieron cargar plantillas desde Supabase. Usando cache local.")
    setLoading(false)
  }

  function updateField(path, value) {
    setTemplate((current) => normalizeTicketTemplate({ ...current, [path]: value }))
  }

  function updateSetting(path, value) {
    setTemplate((current) => normalizeTicketTemplate({ ...current, settings: setAt(current.settings, path, value) }))
  }

  async function saveCurrent(event) {
    event?.preventDefault()
    if (!canEdit) {
      setError("Solo Admin y Gerente General pueden editar disenos de tickets.")
      return
    }
    setSaving(true)
    setError("")
    setMessage("")
    const result = await saveTicketTemplate(template)
    if (result.error) {
      setError(`No se pudo guardar: ${result.message || result.error.message}`)
    } else {
      setTemplate(result.data)
      setTemplates((current) => [result.data, ...current.filter((item) => item.id !== result.data.id && item.template_key !== result.data.template_key)])
      setMessage("Diseno de ticket guardado correctamente.")
    }
    setSaving(false)
  }

  function restoreDefault() {
    if (!window.confirm("Restaurar el diseno por defecto sobrescribira los cambios no guardados. ¿Continuar?")) return
    setTemplate((current) => normalizeTicketTemplate({
      ...defaultTicketTemplate(current.template_key),
      id: current.id,
      template_key: current.template_key,
      name: current.name,
      paper_width: current.paper_width
    }))
    setMessage("Diseno restaurado al formato por defecto.")
    setError("")
  }

  function applyQuickMode(modeKey) {
    const mode = QUICK_MODES[modeKey]
    if (!mode) return
    setTemplate((current) => normalizeTicketTemplate({
      ...current,
      settings: {
        ...current.settings,
        blocks: { ...current.settings.blocks, ...mode.blocks },
        business: { ...current.settings.business, ...(mode.business || {}) },
        orderInfo: { ...current.settings.orderInfo, ...(mode.orderInfo || {}) },
        totals: { ...current.settings.totals, ...(mode.totals || {}) },
        coupon: { ...current.settings.coupon, ...(mode.coupon || {}) },
        qr: { ...current.settings.qr, ...(mode.qr || {}) }
      }
    }))
    setMessage(`Modo ${mode.label} aplicado. Los cambios se ven en vivo; guarda cuando estes conforme.`)
    setError("")
  }

  function updatePreview(field, value) {
    setPreviewData((current) => ({ ...current, [field]: value }))
  }

  async function handleLogoUpload(file) {
    if (!file) return
    if (!canEdit) {
      setError("Solo Admin y Gerente General pueden subir logos.")
      return
    }
    setMessage("Subiendo logo...")
    const result = await uploadTicketAsset(file)
    if (result.error) {
      setError(`No se pudo subir logo: ${result.error.message}`)
      setMessage("")
      return
    }
    updateSetting("business.logoUrl", result.data)
    setMessage("Logo cargado. Guarda cambios para aplicarlo.")
  }

  function printPreview() {
    const popup = window.open("", "_blank", "width=420,height=680")
    if (!popup) {
      setError("No se pudo abrir la vista de impresion. Revisa el bloqueador de ventanas.")
      return
    }
    popup.document.write(previewHtml)
    popup.document.close()
    popup.focus()
    window.setTimeout(() => popup.print(), 150)
  }

  return (
    <section className="ticket-settings-page">
      <header className="ticket-settings-header">
        <div>
          <p>Configuracion</p>
          <h1>Diseno de Tickets</h1>
          <span>Personaliza precuenta, cuenta final, delivery y para llevar sin romper el formato actual.</span>
        </div>
        <button type="button" onClick={printPreview}>Imprimir prueba</button>
      </header>

      {message && <div className="ticket-settings-success">{message}</div>}
      {error && <div className="ticket-settings-error">{error}</div>}
      {loading && <div className="ticket-settings-success">Cargando plantillas...</div>}

      <div className="ticket-settings-layout">
        <form className="ticket-settings-panel" onSubmit={saveCurrent}>
          {!canEdit && <div className="ticket-settings-readonly">Modo lectura. Supervisor puede revisar, pero solo Admin o Gerente General editan.</div>}
          <div className="ticket-settings-help">
            <strong>Activa o desactiva cada bloque para controlar que aparece en el ticket.</strong>
            <span>Los cambios se ven en vivo. Guarda cuando estes conforme.</span>
          </div>

          <section className="ticket-quick-modes">
            <strong>Modos rapidos</strong>
            <div>
              {Object.entries(QUICK_MODES).map(([key, mode]) => (
                <button key={key} type="button" disabled={!canEdit} onClick={() => applyQuickMode(key)}>{mode.label}</button>
              ))}
            </div>
          </section>

          <details open>
            <summary>Bloques visibles</summary>
            <div className="ticket-checkbox-grid">
              {Object.entries(BLOCK_LABELS).map(([key, label]) => (
                <Checkbox key={key} label={label} path={`blocks.${key}`} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
              ))}
            </div>
          </details>

          <details open>
            <summary>1. Plantilla</summary>
            <Field label="Tipo">
              <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                {TICKET_TEMPLATE_TYPES.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Nombre">
              <input value={template.name} disabled={!canEdit} onChange={(event) => updateField("name", event.target.value)} />
            </Field>
            <Field label="Ancho de papel">
              <select value={template.paper_width} disabled={!canEdit} onChange={(event) => updateField("paper_width", event.target.value)}>
                {PAPER_WIDTHS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select value={template.status} disabled={!canEdit} onChange={(event) => updateField("status", event.target.value)}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </Field>
          </details>

          <details>
            <summary>2. Encabezado / negocio</summary>
            <Field label="Logo">
              <input type="file" disabled={!canEdit} accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" onChange={(event) => handleLogoUpload(event.target.files?.[0])} />
            </Field>
            <Checkbox label="Mostrar logo" path="business.showLogo" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Select label="Tamano logo" path="business.logoSize" options={LOGO_SIZES} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="URL logo" path="business.logoUrl" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Nombre comercial" path="business.businessName" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar nombre" path="business.showBusinessName" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Subtitulo" path="business.subtitle" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar subtitulo" path="business.showSubtitle" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="NIT" path="business.nit" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar NIT" path="business.showNit" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Direccion" path="business.address" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar direccion" path="business.showAddress" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Telefono" path="business.phone" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar telefono" path="business.showPhone" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Website" path="business.website" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar website" path="business.showWebsite" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Instagram" path="business.instagram" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar Instagram" path="business.showInstagram" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <details>
            <summary>3. Diseno visual</summary>
            <Select label="Tamano de fuente" path="layout.fontSize" options={FONT_SIZES} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Select label="Fuente" path="layout.fontFamily" options={FONT_FAMILIES} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Select label="Alineacion encabezado" path="layout.alignment" options={ALIGNMENTS} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar divisores" path="layout.showDividers" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Select label="Tipo divisor" path="layout.dividerStyle" options={DIVIDERS} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Modo compacto" path="layout.compactMode" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Emojis" path="layout.showEmojis" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <CheckboxGroup title="4. Datos de orden" prefix="orderInfo" settings={template.settings} onChange={updateSetting} disabled={!canEdit} labels={{
            showOrderId: "Orden", showDate: "Fecha", showCashier: "Cajero", showWaiter: "Mesero", showTable: "Mesa",
            showSalesChannel: "Canal de venta", showPaymentMethod: "Metodo de pago", showCustomerName: "Cliente",
            showCustomerPhone: "Telefono", showDeliveryAddress: "Direccion delivery", showDeliveryReference: "Referencia delivery", showMapsLink: "Link Maps", showDeliveryNotes: "Notas delivery"
          }} />

          <CheckboxGroup title="5. Productos" prefix="items" settings={template.settings} onChange={updateSetting} disabled={!canEdit} labels={{
            showItemModifiers: "Modificadores", showItemNotes: "Notas del producto", showUnitPrice: "Precio unitario", showQuantity: "Cantidad", showLineTotal: "Total linea"
          }} />

          <details>
            <summary>6. Totales</summary>
            <Checkbox label="Subtotal" path="totals.showSubtotal" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Descuentos" path="totals.showDiscounts" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Impuesto" path="totals.showTax" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Servicio" path="totals.showServiceCharge" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Propina sugerida" path="totals.showTipSuggestion" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Porcentajes propina" path="totals.tipSuggestions" value={template.settings} onChange={(path, value) => updateSetting(path, value.split(",").map((item) => Number(item.trim())).filter(Boolean))} disabled={!canEdit} format={(value) => (value || []).join(", ")} />
            <Checkbox label="Total" path="totals.showTotal" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <details>
            <summary>7. Mensajes</summary>
            <TextArea label="Mensaje superior" path="messages.headerMessage" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextArea label="Mensaje inferior" path="messages.footerMessage" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextArea label="Mensaje delivery" path="messages.deliveryMessage" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextArea label="Mensaje resena" path="messages.reviewMessage" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextArea label="Mensaje Club VIP" path="messages.vipMessage" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <details>
            <summary>8. Cupon</summary>
            <Checkbox label="Activar cupon" path="coupon.enabled" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Titulo" path="coupon.title" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Codigo" path="coupon.code" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextArea label="Descripcion" path="coupon.description" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Expira" path="coupon.expiresText" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar caja de cupon" path="coupon.showCouponBox" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <details>
            <summary>9. QR</summary>
            <Checkbox label="Activar QR" path="qr.enabled" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Select label="Tipo QR" path="qr.type" options={QR_TYPES} value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="URL" path="qr.url" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <TextInput label="Etiqueta" path="qr.label" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Mostrar QR" path="qr.showQr" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
          </details>

          <details>
            <summary>10. Impresion</summary>
            <Checkbox label="Auto imprimir" path="print.autoPrint" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Sugerir corte de papel" path="print.cutPaperHint" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <Checkbox label="Abrir gaveta despues de imprimir" path="print.openCashDrawerAfterPrint" value={template.settings} onChange={updateSetting} disabled={!canEdit} />
            <p className="ticket-settings-note">Proxima fase: integracion con impresora termica y gaveta.</p>
          </details>

          <details>
            <summary>Datos de prueba del preview</summary>
            <p className="ticket-settings-note">Los datos de prueba solo afectan la vista previa.</p>
            <PreviewInput label="Nombre cliente" field="customerName" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Telefono cliente" field="customerPhone" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Direccion delivery" field="deliveryAddress" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Referencia delivery" field="deliveryReference" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Metodo de pago" field="paymentMethod" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Canal" field="salesChannel" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Mesa" field="tableName" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Mesero" field="waiterName" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Cajero" field="cashierName" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Producto ejemplo" field="productName" data={previewData} onChange={updatePreview} />
            <PreviewInput label="Precio" field="price" data={previewData} onChange={updatePreview} type="number" />
            <PreviewInput label="Cantidad" field="quantity" data={previewData} onChange={updatePreview} type="number" />
            <PreviewInput label="Modificador / nota" field="itemNote" data={previewData} onChange={updatePreview} />
          </details>

          <div className="ticket-settings-actions">
            <button type="submit" disabled={!canEdit || saving}>{saving ? "Guardando..." : "Guardar cambios"}</button>
            <button type="button" onClick={printPreview}>Vista previa / imprimir prueba</button>
            <button type="button" disabled={!canEdit} onClick={restoreDefault}>Restaurar por defecto</button>
          </div>
        </form>

        <aside className="ticket-preview-panel">
          <div className="ticket-preview-header">
            <strong>Vista previa</strong>
            <span>{template.paper_width}</span>
          </div>
          <iframe title="Vista previa ticket" srcDoc={previewHtml} />
        </aside>
      </div>
    </section>
  )
}

function Field({ label, children }) {
  return <label className="ticket-field"><span>{label}</span>{children}</label>
}

function TextInput({ label, path, value, onChange, disabled, format }) {
  const raw = getAt(value, path)
  return <Field label={label}><input disabled={disabled} value={format ? format(raw) : raw || ""} onChange={(event) => onChange(path, event.target.value)} /></Field>
}

function PreviewInput({ label, field, data, onChange, type = "text" }) {
  return <Field label={label}><input type={type} value={data[field] || ""} onChange={(event) => onChange(field, event.target.value)} /></Field>
}

function TextArea({ label, path, value, onChange, disabled }) {
  return <Field label={label}><textarea disabled={disabled} value={getAt(value, path) || ""} onChange={(event) => onChange(path, event.target.value)} /></Field>
}

function Select({ label, path, options, value, onChange, disabled }) {
  return <Field label={label}><select disabled={disabled} value={getAt(value, path) || ""} onChange={(event) => onChange(path, event.target.value)}>{options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}</select></Field>
}

function Checkbox({ label, path, value, onChange, disabled }) {
  return (
    <label className="ticket-checkbox">
      <input type="checkbox" disabled={disabled} checked={Boolean(getAt(value, path))} onChange={(event) => onChange(path, event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function CheckboxGroup({ title, prefix, settings, labels, onChange, disabled }) {
  return (
    <details>
      <summary>{title}</summary>
      <div className="ticket-checkbox-grid">
        {Object.entries(labels).map(([key, label]) => <Checkbox key={key} label={label} path={`${prefix}.${key}`} value={settings} onChange={onChange} disabled={disabled} />)}
      </div>
    </details>
  )
}

export default TicketTemplateSettings
