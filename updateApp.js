const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend/src/App.jsx');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add state variables after editUserId
const stateInsert = `  const [usuarioDetalleId, setUsuarioDetalleId] = useState(null)
  const [turnoTemp, setTurnoTemp] = useState({ entrada: "09:00", salida: "17:00" })
  const [documentoTemp, setDocumentoTemp] = useState({ tipo: "dpiFrontal", archivo: "" })`;

// Find the line with editUserId and add after it
content = content.replace(
  /const \[editUserId, setEditUserId\] = useState\(null\)/,
  `const [editUserId, setEditUserId] = useState(null)
  ${stateInsert}`
);

// 2. Replace the old userForm with expanded version
const oldUserForm = `const [userForm, setUserForm] = useState({
    nombre: "",
    username: "",
    correo: "",
    telefono: "",
    puesto: "",
    departamento: "",
    rol: "FOH",
    password: "",
    activo: true,
    observaciones: ""
  })`;

const newUserForm = `const [userForm, setUserForm] = useState({
    nombre: "",
    username: "",
    correo: "",
    telefono: "",
    puesto: "",
    departamento: "Administracion",
    rol: "FOH",
    password: "",
    activo: true,
    observaciones: "",
    fotoColaborador: "",
    fechaInicioLabores: "",
    fechaCumpleanos: "",
    turnos: [],
    diasLaborales: ["lunes", "martes", "miercoles", "jueves", "viernes"],
    diaDescanso: "sabado",
    documentos: {
      dpiFrontal: "",
      dpiReverso: "",
      tarjetaSalud: "",
      tarjetaManipulacionAlimentos: "",
      otros: []
    },
    estado: "Activo"
  })`;

content = content.replace(oldUserForm, newUserForm);

// 3. Expand the rolesDisponibles array
const oldRoles = `const rolesDisponibles = [
    "Administrador",
    "Gerente General",
    "Recursos Humanos",
    "Supervisor",
    "Encargado de Almacén",
    "FOH",
    "BOH"
  ]`;

const newRoles = `const rolesDisponibles = [
    "Administrador",
    "Gerente General",
    "Recursos Humanos",
    "Supervisor",
    "Encargado de Almacén",
    "Cocina",
    "Servicio",
    "Barra",
    "Cafeteria",
    "Panaderia",
    "Reposteria",
    "Contabilidad",
    "FOH",
    "BOH"
  ]

  const departamentosDisponibles = [
    "Administracion",
    "Recursos Humanos",
    "Cocina",
    "Pizzeria",
    "Panaderia",
    "Reposteria",
    "Barra",
    "Cafeteria",
    "Servicio",
    "Almacen",
    "Limpieza",
    "Contabilidad"
  ]

  const diasSemana = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]`;

content = content.replace(oldRoles, newRoles);

// 4. Add HR permission function before puedeGestionarRecetas
const puedeGestionarRecetas = `const puedeGestionarRecetas = hasRole(["Administrador", "Gerente General"]);`;

const puedeGestionarUsuarios = `  const puedeGestionarUsuarios = hasRole(["Administrador", "Gerente General", "Recursos Humanos"])

  ${puedeGestionarRecetas}`;

content = content.replace(puedeGestionarRecetas, puedeGestionarUsuarios);

// 5. Add HR helper functions after toggleUsuarioActivo
const toggleUsuarioActivoPattern = /function toggleUsuarioActivo\(id\) \{[^}]*\}/;
const match = content.match(toggleUsuarioActivoPattern);

if (match) {
  const helperFunctions = `

  function agregarTurno() {
    if (!turnoTemp.entrada || !turnoTemp.salida) {
      alert("Ingresa entrada y salida del turno.")
      return
    }
    setUserForm(s => ({
      ...s,
      turnos: [...s.turnos, { ...turnoTemp }]
    }))
    setTurnoTemp({ entrada: "09:00", salida: "17:00" })
  }

  function eliminarTurno(index) {
    setUserForm(s => ({
      ...s,
      turnos: s.turnos.filter((_, i) => i !== index)
    }))
  }

  function toggleDiaLaboral(dia) {
    setUserForm(s => ({
      ...s,
      diasLaborales: s.diasLaborales.includes(dia)
        ? s.diasLaborales.filter(d => d !== dia)
        : [...s.diasLaborales, dia]
    }))
  }

  function subirFotoColaborador(event) {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setUserForm(s => ({
        ...s,
        fotoColaborador: e.target.result
      }))
    }
    reader.readAsDataURL(file)
  }

  function subirDocumentoColaborador(event) {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setUserForm(s => ({
        ...s,
        documentos: {
          ...s.documentos,
          [documentoTemp.tipo]: e.target.result
        }
      }))
    }
    reader.readAsDataURL(file)
  }

  function limpiarFormularioUsuario() {
    setUserForm({
      nombre: "",
      username: "",
      correo: "",
      telefono: "",
      puesto: "",
      departamento: "Administracion",
      rol: "FOH",
      password: "",
      activo: true,
      observaciones: "",
      fotoColaborador: "",
      fechaInicioLabores: "",
      fechaCumpleanos: "",
      turnos: [],
      diasLaborales: ["lunes", "martes", "miercoles", "jueves", "viernes"],
      diaDescanso: "sabado",
      documentos: {
        dpiFrontal: "",
        dpiReverso: "",
        tarjetaSalud: "",
        tarjetaManipulacionAlimentos: "",
        otros: []
      },
      estado: "Activo"
    })
    setEditUserId(null)
  }`;

  content = content.replace(toggleUsuarioActivoPattern, match[0] + helperFunctions);
}

fs.writeFileSync(filePath, content, 'utf-8');
console.log('App.jsx updated successfully!');
