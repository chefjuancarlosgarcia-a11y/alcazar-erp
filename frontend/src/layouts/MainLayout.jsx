import { useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import UserProfileDropdown from "../components/UserProfileDropdown"
import MyProfilePanel from "../components/MyProfilePanel"
import { useAuth } from "../context/AuthContext"
import { useDevice } from "../context/DeviceContext"
import "./MainLayout.css"

function MainLayout() {
  const location = useLocation()
  const { user } = useAuth()
  const device = useDevice()
  const [profilePanelView, setProfilePanelView] = useState("")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isLegacyModule = ["/inventory", "/hr"].includes(location.pathname)
  const deviceClass = device.isMobile ? "device-mobile" : device.isTablet ? "device-tablet" : "device-desktop"

  return (
    <div className={`app-layout ${deviceClass} ${device.isTouchDevice ? "device-touch" : ""}`} style={layoutStyle}>
      {!device.isMobile && <Sidebar compact={device.isTablet} />}
      {device.isMobile && mobileMenuOpen && (
        <>
          <button type="button" className="mobile-nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenuOpen(false)} />
          <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
        </>
      )}
      <div className="app-content" style={contentStyle}>
        {user && (
          <header className="app-account-header" style={accountHeaderStyle}>
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
            <UserProfileDropdown currentUser={user} onOpenProfile={setProfilePanelView} />
          </header>
        )}
        <main className={`app-main ${isLegacyModule ? "app-main-legacy" : ""}`} style={isLegacyModule ? legacyMainStyle : mainStyle}>
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

const layoutStyle = {
  display: "flex",
  width: "100%",
  minHeight: "100vh",
  background: "#071023",
  color: "#e6eef8"
}

const contentStyle = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  flex: 1,
  minHeight: "100vh"
}

const accountHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  minHeight: "64px",
  padding: "10px 22px",
  borderBottom: "1px solid #18283d",
  background: "rgba(7, 16, 35, 0.92)",
  backdropFilter: "blur(15px)",
  boxSizing: "border-box"
}

const mainStyle = {
  position: "relative",
  zIndex: 1,
  flex: 1,
  minWidth: 0,
  padding: "28px",
  overflow: "auto"
}

const legacyMainStyle = {
  ...mainStyle,
  flex: "1 1 100%",
  padding: 0,
  width: "100%",
  minHeight: "100vh",
  overflow: "auto"
}

export default MainLayout
