import { useEffect, useState } from "react"
import { searchPOSCustomers } from "../services/posCustomersService"
import {
  DEFAULT_BILLING_CUSTOMER,
  billingCustomerFromSearchResult,
  normalizeBillingCustomer
} from "../utils/billingCustomer"

export default function CashierBillingCustomer({
  value,
  onChange,
  showAddress = false
}) {
  const billing = normalizeBillingCustomer(value)
  const [searchTerm, setSearchTerm] = useState("")
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState("")

  useEffect(() => {
    const query = searchTerm.trim()
    if (query.length < 2) {
      setSearchResults([])
      setSearchMessage("")
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      const { data, message } = await searchPOSCustomers(query)
      if (cancelled) return
      setSearching(false)
      setSearchResults(data || [])
      setSearchMessage(message || (data?.length ? "" : "Sin coincidencias."))
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchTerm])

  function patch(fields) {
    onChange(normalizeBillingCustomer({ ...billing, ...fields, linked: fields.linked ?? billing.linked }))
  }

  function resetConsumerFinal() {
    onChange({ ...DEFAULT_BILLING_CUSTOMER })
    setSearchTerm("")
    setSearchResults([])
  }

  function selectCustomer(customer) {
    onChange(billingCustomerFromSearchResult(customer))
    setSearchTerm("")
    setSearchResults([])
  }

  return (
    <section className="cashier-billing-customer">
      <div className="cashier-billing-customer-head">
        <div>
          <h3>Datos del cliente</h3>
          <p className="cashier-muted">Facturación y recibo de cobro</p>
        </div>
        {billing.linked && <span className="cashier-billing-linked">Cliente vinculado</span>}
      </div>

      <div className="cashier-billing-search">
        <label>
          Buscar cliente
          <input
            type="search"
            placeholder="Nombre o teléfono..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        {searching && <small className="cashier-billing-search-hint">Buscando...</small>}
        {!searching && searchMessage && searchTerm.trim().length >= 2 && (
          <small className="cashier-billing-search-hint">{searchMessage}</small>
        )}
        {searchResults.length > 0 && (
          <div className="cashier-billing-search-results">
            {searchResults.map((customer) => (
              <button
                type="button"
                key={customer.id}
                className="cashier-billing-search-item"
                onClick={() => selectCustomer(customer)}
              >
                <strong>{customer.full_name}</strong>
                <span>{customer.phone || "Sin teléfono"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cashier-billing-fields">
        <label>
          NIT
          <input
            value={billing.nit}
            onChange={(event) => patch({ nit: event.target.value, linked: false })}
            placeholder="CF"
          />
        </label>
        <label>
          Nombre
          <input
            value={billing.name}
            onChange={(event) => patch({ name: event.target.value, linked: false })}
            placeholder="Consumidor Final"
          />
        </label>
        <label>
          Teléfono
          <input
            value={billing.phone}
            onChange={(event) => patch({ phone: event.target.value, linked: false })}
            placeholder="5555-5555"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={billing.email}
            onChange={(event) => patch({ email: event.target.value, linked: false })}
            placeholder="cliente@correo.com"
          />
        </label>
        {showAddress && (
          <label className="cashier-billing-address">
            Dirección
            <input
              value={billing.address}
              onChange={(event) => patch({ address: event.target.value, linked: false })}
              placeholder="Dirección de entrega o facturación"
            />
          </label>
        )}
      </div>

      <button type="button" className="secondary cashier-billing-reset" onClick={resetConsumerFinal}>
        Usar Consumidor Final
      </button>
    </section>
  )
}
