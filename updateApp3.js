const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend/src/App.jsx');
let content = fs.readFileSync(filePath, 'utf-8');

// Find and replace the entire users section form
const oldFormPattern = /<form onSubmit={crearOActualizarUsuario}>[\s\S]*?<\/form>/;

const newForm = `<form onSubmit={crearOActualizarUsuario}>
                {/* SECCION BASICA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Información Básica</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <input placeholder="Nombre completo" value={userForm.nombre} onChange={(e) => setUserForm((s) => ({ ...s, nombre: e.target.value }))} style={inputStyle} />
                    <input placeholder="Username" value={userForm.username} onChange={(e) => setUserForm((s) => ({ ...s, username: e.target.value }))} style={inputStyle} />
                    <input placeholder="Correo" type="email" value={userForm.correo} onChange={(e) => setUserForm((s) => ({ ...s, correo: e.target.value }))} style={inputStyle} />
                    <input placeholder="Teléfono" value={userForm.telefono} onChange={(e) => setUserForm((s) => ({ ...s, telefono: e.target.value }))} style={inputStyle} />
                    <select value={userForm.departamento} onChange={(e) => setUserForm((s) => ({ ...s, departamento: e.target.value }))} style={inputStyle}>
                      <option value="">Selecciona departamento</option>
                      {departamentosDisponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input placeholder="Puesto/Cargo" value={userForm.puesto} onChange={(e) => setUserForm((s) => ({ ...s, puesto: e.target.value }))} style={inputStyle} />
                  </div>
                </div>

                {/* SECCION CONTRASENA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Credenciales y Rol</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    <select value={userForm.rol} onChange={(e) => setUserForm((s) => ({ ...s, rol: e.target.value }))} style={inputStyle}>
                      <option value="">Selecciona rol</option>
                      {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input placeholder={editUserId ? "Dejar vacío para no cambiar" : "Contraseña requerida"} type="password" value={userForm.password} onChange={(e) => setUserForm((s) => ({ ...s, password: e.target.value }))} style={inputStyle} />
                    <select value={userForm.estado} onChange={(e) => setUserForm((s) => ({ ...s, estado: e.target.value }))} style={inputStyle}>
                      <option value="">Estado</option>
                      <option value="Activo">Activo</option>
                      <option value="Suspendido">Suspendido</option>
                      <option value="Inactivo">Inactivo</option>
                      <option value="Retirado">Retirado</option>
                    </select>
                  </div>
                </div>

                {/* SECCION FECHAS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Fechas</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ color: "#cbd5e1", fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>Fecha de inicio de labores</label>
                      <input type="date" value={userForm.fechaInicioLabores} onChange={(e) => setUserForm((s) => ({ ...s, fechaInicioLabores: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ color: "#cbd5e1", fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>Fecha de nacimiento</label>
                      <input type="date" value={userForm.fechaCumpleanos} onChange={(e) => setUserForm((s) => ({ ...s, fechaCumpleanos: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* SECCION HORARIOS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Horarios</h3>
                  <div style={{ marginBottom: "12px", padding: "12px", backgroundColor: "#0f1724", borderRadius: "8px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", alignItems: "flex-end" }}>
                      <input placeholder="Hora entrada (HH:MM)" type="time" value={turnoTemp.entrada} onChange={(e) => setTurnoTemp((s) => ({ ...s, entrada: e.target.value }))} style={inputStyle} />
                      <input placeholder="Hora salida (HH:MM)" type="time" value={turnoTemp.salida} onChange={(e) => setTurnoTemp((s) => ({ ...s, salida: e.target.value }))} style={inputStyle} />
                      <button type="button" onClick={agregarTurno} style={buttonStyle}>Agregar turno</button>
                    </div>
                  </div>
                  <div>
                    {userForm.turnos && userForm.turnos.map((turno, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px", marginBottom: "6px" }}>
                        <span>{turno.entrada} - {turno.salida}</span>
                        <button type="button" onClick={() => eliminarTurno(idx)} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}>Eliminar</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SECCION DIAS LABORALES */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Días Laborales</h3>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {diasSemana.map((dia) => (
                        <label key={dia} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", backgroundColor: userForm.diasLaborales.includes(dia) ? "#0ea5a4" : "#1a2332", borderRadius: "6px", cursor: "pointer" }}>
                          <input type="checkbox" checked={userForm.diasLaborales.includes(dia)} onChange={() => toggleDiaLaboral(dia)} style={{ cursor: "pointer" }} />
                          <span style={{ textTransform: "capitalize" }}>{dia}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <select value={userForm.diaDescanso} onChange={(e) => setUserForm((s) => ({ ...s, diaDescanso: e.target.value }))} style={inputStyle}>
                    <option value="">Día de descanso</option>
                    {diasSemana.map((d) => <option key={d} value={d} style={{ textTransform: "capitalize" }}>{d}</option>)}
                  </select>
                </div>

                {/* SECCION FOTOGRAFIA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Fotografía</h3>
                  <input type="file" accept="image/*" onChange={subirFotoColaborador} style={inputStyle} />
                  {userForm.fotoColaborador && (
                    <div style={{ marginTop: "8px" }}>
                      <img src={userForm.fotoColaborador} alt="Foto" style={{ maxWidth: "150px", height: "auto", borderRadius: "8px" }} />
                    </div>
                  )}
                </div>

                {/* SECCION DOCUMENTOS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Documentos</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", alignItems: "flex-end", marginBottom: "12px" }}>
                    <select value={documentoTemp.tipo} onChange={(e) => setDocumentoTemp((s) => ({ ...s, tipo: e.target.value }))} style={inputStyle}>
                      <option value="dpiFrontal">DPI Frontal</option>
                      <option value="dpiReverso">DPI Reverso</option>
                      <option value="tarjetaSalud">Tarjeta de Salud</option>
                      <option value="tarjetaManipulacionAlimentos">Tarjeta de Manipulación de Alimentos</option>
                      <option value="otros">Otros</option>
                    </select>
                    <input type="file" onChange={subirDocumentoColaborador} style={inputStyle} />
                    <button type="button" style={buttonStyle}>Subir documento</button>
                  </div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {userForm.documentos.dpiFrontal && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ DPI Frontal cargado</div>}
                    {userForm.documentos.dpiReverso && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ DPI Reverso cargado</div>}
                    {userForm.documentos.tarjetaSalud && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ Tarjeta de Salud cargada</div>}
                    {userForm.documentos.tarjetaManipulacionAlimentos && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ Tarjeta de Manipulación cargada</div>}
                  </div>
                </div>

                {/* SECCION OBSERVACIONES */}
                <div style={{ marginBottom: "16px" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Observaciones Adicionales</h3>
                  <textarea placeholder="Notas sobre el colaborador..." value={userForm.observaciones} onChange={(e) => setUserForm((s) => ({ ...s, observaciones: e.target.value }))} style={{ ...inputStyle, minHeight: "80px" }} />
                </div>

                {/* BOTONES */}
                <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                  <button type="submit" style={buttonStyle}>{editUserId ? "Actualizar Colaborador" : "Crear Colaborador"}</button>
                  {editUserId && (
                    <button type="button" onClick={() => { setEditUserId(null); limpiarFormularioUsuario() }} style={cancelButtonStyle}>
                      Cancelar
                    </button>
                  )}
                </div>
              </form>`;

// Replace the entire form
const match = content.match(oldFormPattern);
if (match) {
  content = content.replace(match[0], newForm);
  console.log('Form replaced successfully!');
} else {
  console.log('Form pattern not found, trying alternative approach...');
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('App.jsx form updated!');
