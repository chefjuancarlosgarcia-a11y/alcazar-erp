import { useRef } from "react"
import "./PurchaseOrders.css"

export default function ReceptionImageCapture({ image, onSelect, onClear }) {
  const cameraInputRef = useRef(null)
  const galleryInputRef = useRef(null)

  function handleChange(event) {
    onSelect(event)
    event.target.value = ""
  }

  return (
    <div className="po-reception-image">
      <div className="po-reception-image__actions">
        <button
          type="button"
          className="erp-btn erp-btn--teal"
          onClick={() => cameraInputRef.current?.click()}
        >
          Tomar foto
        </button>
        <button
          type="button"
          className="erp-btn erp-btn--secondary"
          onClick={() => galleryInputRef.current?.click()}
        >
          Elegir imagen
        </button>
        {image && (
          <button type="button" className="erp-btn erp-btn--danger" onClick={onClear}>
            Quitar
          </button>
        )}
      </div>
      <p className="po-help">En celular o tablet, «Tomar foto» abre la cámara para capturar la factura al instante.</p>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="po-reception-image__input"
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="po-reception-image__input"
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      {image ? (
        <img src={image} alt="Factura o recepción" className="po-preview-image po-reception-image__preview" />
      ) : (
        <p className="po-empty">Sin imagen de factura.</p>
      )}
    </div>
  )
}
