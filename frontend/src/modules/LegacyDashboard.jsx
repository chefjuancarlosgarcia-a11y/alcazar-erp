function LegacyDashboard({
  usuarioActual,
  modulosPermitidos,
  seccionActiva,
  setSeccionActiva,
  cerrarSesion,
  sectionButtonStyle
}) {
  return (
    <>
      <div>
        <h1>Dashboard</h1>
        <p>Bienvenido al sistema.</p>
      </div>

      <div style={{ display: "grid", gap: "20px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ flex: "1 1 320px", padding: "20px", borderRadius: "12px", background: "#0f172a", border: "1px solid #334155" }}>
            <h2 style={{ marginTop: 0 }}>Bienvenido, {usuarioActual.nombre}</h2>
            <p style={{ color: "#cbd5e1", margin: "8px 0" }}><strong>Rol:</strong> {usuarioActual.rol}</p>
            {usuarioActual.departamento && (
              <p style={{ color: "#cbd5e1", margin: "8px 0" }}><strong>Departamento:</strong> {usuarioActual.departamento}</p>
            )}
            <p style={{ color: "#cbd5e1", marginTop: "12px" }}>
              Accede a los módulos que tienes permitidos según tu rol. La plataforma carga solo lo que te corresponde.
            </p>
          </div>
          <div style={{ flex: "1 1 240px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={cerrarSesion} style={{ ...sectionButtonStyle, width: "100%", padding: "14px 16px", background: "#ef4444", color: "#fff", border: "1px solid transparent" }}>
              Cerrar sesión
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {modulosPermitidos.map((modulo) => (
            <button
              key={modulo.key}
              onClick={() => setSeccionActiva(modulo.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "10px",
                padding: "20px",
                minHeight: "140px",
                borderRadius: "12px",
                border: "1px solid #334155",
                background: seccionActiva === modulo.key ? "#0ea5a4" : "#0f172a",
                color: seccionActiva === modulo.key ? "#021" : "#e6eef8",
                textAlign: "left",
                cursor: "pointer"
              }}
            >
              <span style={{ fontSize: "24px" }}>{modulo.icon}</span>
              <strong>{modulo.label}</strong>
              <span style={{ color: "#94a3b8", fontSize: "0.95rem" }}>
                Accede a {modulo.label.toLowerCase()}.
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export default LegacyDashboard

