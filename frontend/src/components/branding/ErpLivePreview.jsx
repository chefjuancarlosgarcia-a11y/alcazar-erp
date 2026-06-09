import { useEffect, useRef } from "react"
import { applyBrandingTheme } from "../../utils/brandingTheme"

export default function ErpLivePreview({ branding }) {
  const rootRef = useRef(null)

  useEffect(() => {
    if (rootRef.current) applyBrandingTheme(branding, rootRef.current)
  }, [branding])

  const logo = branding.logoUrl
  const compactLogo = branding.compactLogoUrl || branding.logoUrl

  return (
    <div className="erp-live-preview" ref={rootRef}>
      <div className="erp-live-preview-shell">
        <aside className="erp-live-sidebar">
          <div className="erp-live-brand">
            <span className="erp-live-logo">
              {logo ? <img src={logo} alt="" /> : branding.monogram}
            </span>
            <div>
              <strong>{branding.commercialName || "Mi restaurante"}</strong>
              <small>{branding.subtitle || "Sistema operativo"}</small>
            </div>
          </div>
          <nav>
            <button type="button" className="active">Dashboard</button>
            <button type="button">Punto de Venta</button>
            <button type="button">Caja</button>
            <button type="button">Cocina</button>
            <button type="button">Reportes</button>
          </nav>
          <div className="erp-live-compact-logo">
            {compactLogo ? <img src={compactLogo} alt="" /> : <span>{branding.monogram}</span>}
            <em>Vista compacta</em>
          </div>
        </aside>

        <main className="erp-live-main">
          <header>
            <div>
              <p>Panel principal</p>
              <h3>Resumen del dia</h3>
            </div>
            <div className="erp-live-header-actions">
              <button type="button" className="ghost">Exportar</button>
              <button type="button" className="primary">Nueva orden</button>
            </div>
          </header>

          <div className="erp-live-kpis">
            <article><span>Ventas hoy</span><strong>Q12,480.00</strong></article>
            <article><span>Ordenes</span><strong>86</strong></article>
            <article className="success"><span>Meta</span><strong>78%</strong></article>
            <article className="warning"><span>Alertas</span><strong>3</strong></article>
          </div>

          <section className="erp-live-card">
            <div className="erp-live-card-head">
              <h4>Ordenes recientes</h4>
              <button type="button" className="danger-link">Ver incidencias</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Mesa</th>
                  <th>Colaborador</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>12</td><td>Mariana</td><td>Q245.00</td><td><span className="badge success">Pagada</span></td></tr>
                <tr><td>POS-18</td><td>Carlos</td><td>Q128.50</td><td><span className="badge warning">En cocina</span></td></tr>
                <tr><td>8</td><td>Luis</td><td>Q312.00</td><td><span className="badge">Abierta</span></td></tr>
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </div>
  )
}
