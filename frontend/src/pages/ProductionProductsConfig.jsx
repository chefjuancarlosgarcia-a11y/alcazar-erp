import { useEffect, useMemo, useState } from "react"
import ProductionBackButton from "../components/production/ProductionBackButton"
import ProductionToast from "../components/production/ProductionToast"
import { useAuth } from "../context/AuthContext"
import { canManageProductionAreas } from "../utils/kds"
import { getProductionAreasEnriched } from "../services/productionAreasService"
import { getPOSProducts, updatePOSProduct } from "../services/posProductsService"
import "./Production.css"

export default function ProductionProductsConfig() {
  const { user } = useAuth()
  const [areas, setAreas] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState("")
  const [filterArea, setFilterArea] = useState("all")
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState("")
  const [message, setMessage] = useState("")
  const [toastTone, setToastTone] = useState("info")

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [areaResult, productResult] = await Promise.all([
        getProductionAreasEnriched(),
        getPOSProducts()
      ])
      setAreas(areaResult.data || [])
      setProducts(productResult.data || [])
      if (areaResult.error || productResult.error) {
        setMessage("No se pudo cargar el catálogo de productos.")
        setToastTone("error")
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) => {
      if (filterArea === "unassigned" && product.productionAreaId) return false
      if (filterArea !== "all" && filterArea !== "unassigned" && product.productionAreaId !== filterArea) return false
      if (!term) return true
      return [product.name, product.categoryName, product.productionAreaId].some((value) => String(value || "").toLowerCase().includes(term))
    })
  }, [products, search, filterArea])

  if (!canManageProductionAreas(user)) {
    return (
      <section className="production-admin">
        <ProductionBackButton />
        <article className="production-empty-card"><p>No tienes permiso para configurar productos por área.</p></article>
      </section>
    )
  }

  async function assignArea(product, areaId) {
    setSavingId(product.id)
    const { error } = await updatePOSProduct(product.id, {
      ...product,
      productionAreaId: areaId || null
    })
    setSavingId("")
    if (error) {
      setMessage(error.message || "No se pudo actualizar el producto.")
      setToastTone("error")
      return
    }
    setProducts((current) => current.map((entry) => (
      entry.id === product.id ? { ...entry, productionAreaId: areaId || "" } : entry
    )))
    setMessage(`"${product.name}" asignado correctamente.`)
    setToastTone("success")
  }

  return (
    <section className="production-admin">
      <ProductionBackButton />
      <header className="production-admin__header">
        <div>
          <p className="kds-eyebrow">Administración</p>
          <h1>Configuración de productos por área</h1>
          <p className="production-hub__subtitle">Define a qué estación KDS debe enviarse cada producto del menú.</p>
        </div>
      </header>

      <ProductionToast message={message} tone={toastTone} />

      <div className="production-admin__toolbar">
        <input
          type="search"
          placeholder="Buscar producto..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={filterArea} onChange={(event) => setFilterArea(event.target.value)}>
          <option value="all">Todas las áreas</option>
          <option value="unassigned">Sin área asignada</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
      </div>

      <div className="production-admin__panel">
        {loading ? <p>Cargando productos...</p> : !filtered.length ? (
          <p className="production-empty-inline">No hay productos que coincidan con los filtros.</p>
        ) : (
          <div className="production-admin__list">
            {filtered.map((product) => (
              <article key={product.id} className="production-admin__list-item">
                <div>
                  <strong>{product.name}</strong>
                  <p>{product.categoryName || "Sin categoría"} · {product.active ? "Activo" : "Inactivo"}</p>
                  <small>Área actual: {areas.find((area) => area.id === product.productionAreaId)?.name || "Sin asignar (default: Cocina)"}</small>
                </div>
                <label className="production-admin__select-wrap">
                  Área de producción
                  <select
                    value={product.productionAreaId || ""}
                    disabled={savingId === product.id}
                    onChange={(event) => assignArea(product, event.target.value || null)}
                  >
                    <option value="">Default: Cocina</option>
                    {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                  </select>
                </label>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
