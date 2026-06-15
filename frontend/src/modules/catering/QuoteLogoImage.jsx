import { useEffect, useState } from "react"
import { loadQuoteLogoDataUrl } from "./cateringQuoteLogo"

export default function QuoteLogoImage({
  logoUrl,
  alt = "",
  className = "",
  placeholder = "GA"
}) {
  const [src, setSrc] = useState(logoUrl || "")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setFailed(false)

    if (!logoUrl) {
      setSrc("")
      return undefined
    }

    setSrc(logoUrl)
    loadQuoteLogoDataUrl(logoUrl).then((dataUrl) => {
      if (active && dataUrl) setSrc(dataUrl)
    })

    return () => {
      active = false
    }
  }, [logoUrl])

  if (!logoUrl || failed) {
    return <div className={`catering-quote-preview__logo-placeholder ${className}`.trim()}>{placeholder}</div>
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
