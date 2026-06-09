import { resolveLogoUrl } from "../../utils/brandingTheme"
import "./BrandLogo.css"

export default function BrandLogo({
  branding,
  variant = "full",
  showText = true,
  className = ""
}) {
  const data = branding || {}
  const compact = variant === "compact" || variant === "header"
  const logoUrl = resolveLogoUrl(data, { compact })
  const monogram = String(data.monogram || "GA").slice(0, 3).toUpperCase()
  const name = data.commercialName || "Mi restaurante"
  const subtitle = data.subtitle || ""

  return (
    <div className={`brand-logo brand-logo-${variant} ${className}`.trim()}>
      <span className="brand-logo-mark" aria-hidden={logoUrl ? undefined : true}>
        {logoUrl ? <img src={logoUrl} alt="" /> : monogram}
      </span>
      {showText && (
        <div className="brand-logo-copy">
          <strong>{name}</strong>
          {variant !== "compact" && subtitle && <small>{subtitle}</small>}
        </div>
      )}
    </div>
  )
}
