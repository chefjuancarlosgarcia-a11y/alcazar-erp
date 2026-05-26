function LocalNetworkAccessBanner() {
  if (!import.meta.env.DEV) return null

  const port = import.meta.env.VITE_PORT || "5173"
  const localIp = import.meta.env.VITE_LOCAL_IP || window.location.hostname
  const localUrl = `http://localhost:${port}`
  const networkUrl = localIp && localIp !== "localhost" ? `http://${localIp}:${port}` : ""

  return (
    <div style={bannerStyle}>
      <strong>Acceso local habilitado</strong>
      <span>Local: {localUrl}</span>
      {networkUrl && <span>Wi-Fi: {networkUrl}</span>}
    </div>
  )
}

const bannerStyle = {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: 9999,
  display: "grid",
  gap: "4px",
  maxWidth: "320px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #334155",
  backgroundColor: "rgba(15, 23, 42, 0.94)",
  color: "#dbeafe",
  boxShadow: "0 18px 45px rgba(0, 0, 0, 0.35)",
  fontSize: "0.78rem",
  lineHeight: 1.25,
  pointerEvents: "none"
}

export default LocalNetworkAccessBanner
