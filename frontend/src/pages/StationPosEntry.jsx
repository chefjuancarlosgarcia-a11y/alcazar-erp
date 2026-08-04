import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { BRANDING } from "../branding"
import OperationalStationPinGate from "../components/OperationalStationPinGate"
import {
  clearOperatorSession,
  loadOperatorSessionMeta,
  loadOperatorSessionToken,
  saveOperatorSession
} from "../services/operationalStationAccessService"
import {
  createStationPosOrdersFacadeAdapter,
  createStationPosPort,
  fetchOperationalStationPosEnabled
} from "../services/stationPosService"
import { PosOrdersPortProvider } from "../services/posOrdersPortContext"
import { clearStationPosOrdersDelegate } from "../services/posOrdersFacade"
import { isOperatorSessionExpired } from "../services/operationalOperatorIdle"
import "./StationPosEntry.css"

const POS = lazy(() => import("./POS"))

export default function StationPosEntry() {
  const { stationDeviceContext } = useAuth()
  const [posEnabled, setPosEnabled] = useState(null)
  const [sessionToken, setSessionToken] = useState(() => loadOperatorSessionToken())
  const [operatorMeta, setOperatorMeta] = useState(() => loadOperatorSessionMeta())
  const stationName = stationDeviceContext?.station_name || "POS"
  const isPosStation = stationDeviceContext?.station_type === "pos"

  useEffect(() => {
    fetchOperationalStationPosEnabled().then(({ enabled }) => setPosEnabled(enabled))
  }, [])

  const handleOperatorLocked = useCallback(() => {
    clearOperatorSession()
    setSessionToken("")
    setOperatorMeta(null)
    clearStationPosOrdersDelegate()
  }, [])

  useEffect(() => {
    if (!sessionToken) {
      clearStationPosOrdersDelegate()
      return undefined
    }
    const timer = setInterval(() => {
      const meta = loadOperatorSessionMeta()
      if (isOperatorSessionExpired(meta?.idleExpiresAt)) handleOperatorLocked()
    }, 1000)
    return () => clearInterval(timer)
  }, [sessionToken, handleOperatorLocked])

  const posPort = useMemo(() => {
    if (!sessionToken) return null
    return createStationPosPort(sessionToken, {
      onOperatorLocked: handleOperatorLocked,
      onContextLoaded: (idleExpiresAt) => {
        const meta = loadOperatorSessionMeta()
        if (meta) saveOperatorSession(sessionToken, { ...meta, idleExpiresAt })
      }
    })
  }, [sessionToken, handleOperatorLocked])

  const facadePort = useMemo(() => {
    if (!posPort) return null
    return createStationPosOrdersFacadeAdapter(posPort)
  }, [posPort])

  useEffect(() => () => clearStationPosOrdersDelegate(), [])

  if (!isPosStation) {
    return (
      <section className="erp-page-shell station-pos-entry">
        <p>Esta terminal no es una estación tipo POS.</p>
      </section>
    )
  }

  if (posEnabled === false) {
    return (
      <section className="erp-page-shell station-pos-entry station-pos-entry--disabled">
        <div className="station-pos-disabled-card">
          <h1>POS en estación no disponible</h1>
          <p>La fase POS compartida está deshabilitada (`operational_station_pos_enabled = false`).</p>
          <p className="station-pos-disabled-muted">El POS humano en /pos no se ve afectado.</p>
        </div>
      </section>
    )
  }

  if (!sessionToken || !operatorMeta?.operatorName) {
    return (
      <section className="erp-page-shell station-pos-entry station-pos-entry--pin-gate">
        <OperationalStationPinGate
          accessTitle={`Acceso a ${stationName}`}
          module="pos"
          monogram={BRANDING.monogram}
          logoUrl={BRANDING.logoUrl}
          onVerified={() => {
            if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
              document.activeElement.blur()
            }
            setSessionToken(loadOperatorSessionToken())
            setOperatorMeta(loadOperatorSessionMeta())
          }}
        />
      </section>
    )
  }

  return (
    <section className="erp-page-shell station-pos-entry station-pos-entry--active">
      <header className="station-pos-entry-banner">
        <span>Estación POS — {stationName}</span>
        <span>Operando como {operatorMeta.operatorName}</span>
        <button type="button" onClick={() => posPort?.lockOperator("manual_lock")}>
          Bloquear mesero
        </button>
      </header>
      <Suspense fallback={<p>Cargando POS…</p>}>
        <PosOrdersPortProvider port={facadePort}>
          <POS stationMode stationPosPort={posPort} onStationTerminalAction={handleOperatorLocked} />
        </PosOrdersPortProvider>
      </Suspense>
    </section>
  )
}
