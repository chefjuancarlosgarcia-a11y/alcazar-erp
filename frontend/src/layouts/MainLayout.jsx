import { useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import MigrationModeBanner from "../components/inventory/MigrationModeBanner"
import BrandLogo from "../components/branding/BrandLogo"
import NotificationsBell from "../components/NotificationsBell"
import UserProfileDropdown from "../components/UserProfileDropdown"
import MyProfilePanel from "../components/MyProfilePanel"
import { useAuth } from "../context/AuthContext"
import { useBrandingContext } from "../context/BrandingProvider"
import { useDevice } from "../context/DeviceContext"
import "./MainLayout.css"

function MainLayout() {
  const location = useLocation()
  const { user } = useAuth()
  const branding = useBrandingContext()
  const device = useDevice()
  const [profilePanelView, setProfilePanelView] = useState("")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isLegacyModule = ["/inventory", "/hr"].includes(location.pathname)
  const deviceClass = device.isMobile ? "device-mobile" : device.isTablet ? "device-tablet" : "device-desktop"
  const showAccountHeader = Boolean(user)

  return (
    <div className={`app-layout ${deviceClass} ${device.isTouchDevice ? "device-touch" : ""}`}>
      {!device.isMobile && <Sidebar compact={device.isTablet} />}
      {device.isMobile && mobileMenuOpen && (
        <>
          <button type="button" className="mobile-nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenuOpen(false)} />
          <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
        </>
      )}
      <div className="app-content">
        {showAccountHeader && (
          <header className="app-account-header">
            <div className="app-account-header-brand">
              <BrandLogo branding={branding} variant="header" showText={!device.isMobile} />
            </div>
            {device.isMobile && (
              <button
                type="button"
                className="mobile-menu-button"
                aria-label="Abrir menú principal"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((current) => !current)}
              >
                <span aria-hidden="true">☰</span>
                Menú
              </button>
            )}
            <NotificationsBell currentUser={user} />
            <UserProfileDropdown currentUser={user} onOpenProfile={setProfilePanelView} />
          </header>
        )}
        <MigrationModeBanner />
        <main className={`app-main ${isLegacyModule ? "app-main-legacy" : ""}`}>
          <Outlet />
        </main>
      </div>
      {import.meta.env.DEV && <DeviceIndicator device={device} />}
      {user && profilePanelView && (
        <MyProfilePanel
          currentUser={user}
          initialView={profilePanelView}
          onClose={() => setProfilePanelView("")}
        />
      )}
    </div>
  )
}

function DeviceIndicator({ device }) {
  const size = device.isMobile ? "Mobile" : device.isTablet ? "Tablet" : "Desktop"
  const system = device.isAndroid ? "Android" : device.isIOS ? "iOS" : "Otro"
  const orientation = device.orientation === "portrait" ? "Portrait" : "Landscape"

  return (
    <aside className="device-indicator" aria-label="Información de dispositivo">
      {size} / {system} / {orientation}
    </aside>
  )
}

export default MainLayout
