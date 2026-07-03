import { useRef, useState } from "react"
import "./RequiredPhotoUpload.css"

export default function RequiredPhotoUpload({
  label = "Foto obligatoria",
  hint = "JPG, PNG o WebP. Máximo 10 MB.",
  onFileChange,
  disabled = false,
  previewUrl = null
}) {
  const inputRef = useRef(null)
  const [localPreview, setLocalPreview] = useState(null)
  const [error, setError] = useState("")

  const displayPreview = localPreview || previewUrl

  function handleChange(event) {
    const file = event.target.files?.[0]
    setError("")
    if (!file) {
      setLocalPreview(null)
      onFileChange?.(null)
      return
    }

    const allowed = ["image/jpeg", "image/png", "image/webp"]
    if (!allowed.includes(file.type)) {
      setError("Formato no permitido.")
      event.target.value = ""
      onFileChange?.(null)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("La foto supera 10 MB.")
      event.target.value = ""
      onFileChange?.(null)
      return
    }

    setLocalPreview(URL.createObjectURL(file))
    onFileChange?.(file)
  }

  return (
    <div className="required-photo-upload">
      <label className="required-photo-upload__label">{label} *</label>
      <p className="required-photo-upload__hint">{hint}</p>
      <div className="required-photo-upload__actions">
        <button
          type="button"
          className="required-photo-upload__btn"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {displayPreview ? "Cambiar foto" : "Tomar / subir foto"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          disabled={disabled}
          onChange={handleChange}
        />
      </div>
      {displayPreview && (
        <img src={displayPreview} alt="Vista previa" className="required-photo-upload__preview" />
      )}
      {error && <p className="required-photo-upload__error">{error}</p>}
    </div>
  )
}
