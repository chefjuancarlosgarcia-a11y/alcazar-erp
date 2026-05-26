function LegacySidebar({
  seccionActiva,
  setSeccionActiva,
  modulosPermitidos,
  mostrarNotificaciones,
  toggleNotificaciones,
  nuevasNotificacionesCount,
  notificaciones,
  styles
}) {
  const {
    headerStyle,
    tabBarStyle,
    sectionButtonStyle,
    activeTabButtonStyle,
    notificationBellWrapperStyle,
    notificationBellButtonStyle,
    notificationBadgeStyle,
    notificationPanelStyle,
    notificationPanelHeaderStyle,
    notificationItemStyle,
    cancelButtonStyle
  } = styles

  return (
    <div style={headerStyle}>
      <div style={tabBarStyle}>
        <button
          onClick={() => setSeccionActiva("dashboard")}
          style={seccionActiva === "dashboard" ? activeTabButtonStyle : sectionButtonStyle}
        >
          Dashboard
        </button>
        {modulosPermitidos.map((modulo) => (
          <button
            key={modulo.key}
            onClick={() => setSeccionActiva(modulo.key)}
            style={seccionActiva === modulo.key ? activeTabButtonStyle : sectionButtonStyle}
          >
            {modulo.label}
          </button>
        ))}
      </div>

      <div style={notificationBellWrapperStyle}>
        <button onClick={toggleNotificaciones} style={notificationBellButtonStyle}>
          <span role="img" aria-label="Notificaciones" style={{ fontSize: "20px" }}>
            🔔
          </span>
          {nuevasNotificacionesCount > 0 && (
            <span style={notificationBadgeStyle}>{nuevasNotificacionesCount}</span>
          )}
        </button>
        {mostrarNotificaciones && (
          <div style={notificationPanelStyle}>
            <div style={notificationPanelHeaderStyle}>
              <strong>Notificaciones</strong>
              <button onClick={toggleNotificaciones} style={cancelButtonStyle}>
                Cerrar
              </button>
            </div>
            {notificaciones.length === 0 ? (
              <p style={{ color: "#9ca3af" }}>No hay notificaciones nuevas.</p>
            ) : (
              notificaciones.map((item) => (
                <div key={item.id} style={notificationItemStyle}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{item.mensaje}</p>
                  <p style={{ margin: "6px 0 0", color: "#9ca3af", fontSize: "0.85rem" }}>
                    {item.fecha}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default LegacySidebar

