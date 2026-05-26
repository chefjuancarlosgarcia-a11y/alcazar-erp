import { useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import UserProfileDropdown from "../components/UserProfileDropdown"
import MyProfilePanel from "../components/MyProfilePanel"
import { useAuth } from "../context/AuthContext"

function MainLayout() {
  const location = useLocation()
  const { user } = useAuth()
  const [profilePanelView, setProfilePanelView] = useState("")
  const isLegacyModule = ["/inventory", "/hr"].includes(location.pathname)

  return (
    <div style={layoutStyle}>
      <Sidebar />
      <div style={contentStyle}>
        {user && (
          <header style={accountHeaderStyle}>
            <UserProfileDropdown currentUser={user} onOpenProfile={setProfilePanelView} />
          </header>
        )}
        <main style={isLegacyModule ? legacyMainStyle : mainStyle}>
          <Outlet />
        </main>
      </div>
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
