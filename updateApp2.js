const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend/src/App.jsx');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Update crearOActualizarUsuario validation
const oldValidation = `function crearOActualizarUsuario(e) {
    e && e.preventDefault()
    if (!userForm.username.trim() || !userForm.nombre.trim() || !userForm.correo.trim()) {
      alert("Nombre, username y correo son obligatorios.")
      return
    }

    if (!editUserId && !userForm.password) {
      alert("La contraseña es obligatoria al crear un usuario.")
      return
    }`;

const newValidation = `function crearOActualizarUsuario(e) {
    e && e.preventDefault()
    if (!userForm.username.trim() || !userForm.nombre.trim() || !userForm.correo.trim()) {
      alert("Nombre, username y correo son obligatorios.")
      return
    }

    if (!editUserId && !userForm.password) {
      alert("La contraseña es obligatoria al crear un usuario.")
      return
    }

    if (!userForm.rol) {
      alert("Rol es obligatorio.")
      return
    }

    if (!userForm.departamento) {
      alert("Departamento es obligatorio.")
      return
    }

    if (!userForm.fechaInicioLabores) {
      alert("Fecha de inicio de labores es obligatoria.")
      return
    }

    if (!userForm.turnos || userForm.turnos.length === 0) {
      alert("Agrega al menos un turno.")
      return
    }

    if (!userForm.estado) {
      alert("Estado es obligatorio.")
      return
    }`;

content = content.replace(oldValidation, newValidation);

// 2. Update editarUsuario to include new fields
const oldEditarUsuario = `function editarUsuario(usuario) {
    setEditUserId(usuario.id)
    setUserForm({ nombre: usuario.nombre || "", username: usuario.username || "", correo: usuario.correo || "", telefono: usuario.telefono || "", puesto: usuario.puesto || "", departamento: usuario.departamento || "", rol: usuario.rol || "FOH", password: "", activo: usuario.activo, observaciones: usuario.observaciones || "" })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }`;

const newEditarUsuario = `function editarUsuario(usuario) {
    setEditUserId(usuario.id)
    setUserForm({
      nombre: usuario.nombre || "",
      username: usuario.username || "",
      correo: usuario.correo || "",
      telefono: usuario.telefono || "",
      puesto: usuario.puesto || "",
      departamento: usuario.departamento || "Administracion",
      rol: usuario.rol || "FOH",
      password: "",
      activo: usuario.activo || true,
      observaciones: usuario.observaciones || "",
      fotoColaborador: usuario.fotoColaborador || "",
      fechaInicioLabores: usuario.fechaInicioLabores || "",
      fechaCumpleanos: usuario.fechaCumpleanos || "",
      turnos: usuario.turnos || [],
      diasLaborales: usuario.diasLaborales || ["lunes", "martes", "miercoles", "jueves", "viernes"],
      diaDescanso: usuario.diaDescanso || "sabado",
      documentos: usuario.documentos || {
        dpiFrontal: "",
        dpiReverso: "",
        tarjetaSalud: "",
        tarjetaManipulacionAlimentos: "",
        otros: []
      },
      estado: usuario.estado || "Activo"
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }`;

content = content.replace(oldEditarUsuario, newEditarUsuario);

// 3. Update the form reset in crearOActualizarUsuario (inside the async function)
const oldReset = `setUserForm({ nombre: "", username: "", correo: "", telefono: "", puesto: "", departamento: "", rol: "FOH", password: "", activo: true, observaciones: "" })`;

const newReset = `limpiarFormularioUsuario()`;

content = content.replace(oldReset, newReset);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('App.jsx validation and functions updated successfully!');
