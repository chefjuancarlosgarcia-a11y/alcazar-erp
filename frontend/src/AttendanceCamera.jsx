import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

const TIPOS_MARCAJE = ["Entrada", "Salida", "Ida al baño", "Regreso del baño"]
const ROLES_PERMITIDOS = ["Administrador", "Gerente General", "Recursos Humanos"]

function AttendanceCamera({ usuarioActual, usuarios }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [cameraStream, setCameraStream] = useState(null)
  const [cameraStatus, setCameraStatus] = useState("apagada")
  const [cameraMessage, setCameraMessage] = useState("Cámara apagada")
  const [cameraFacingMode, setCameraFacingMode] = useState("user")
  const [photoPreview, setPhotoPreview] = useState("")
  const [attendanceRecords, setAttendanceRecords] = useState(() => {
    const datos = localStorage.getItem("attendanceRecords")
    return datos ? JSON.parse(datos) : []
  })
  const [auditRecords, setAuditRecords] = useState(() => {
    const datos = localStorage.getItem("attendanceAudits")
    return datos ? JSON.parse(datos) : []
  })
  const [availableCameras, setAvailableCameras] = useState([])
  const [selectedCameraId, setSelectedCameraId] = useState("")
  const [selectedTipo, setSelectedTipo] = useState("Entrada")
  const [observaciones, setObservaciones] = useState("")
  const [attendanceTab, setAttendanceTab] = useState("registro")
  const [saving, setSaving] = useState(false)
  const [alertMessage, setAlertMessage] = useState("")
  const [filters, setFilters] = useState({ colaborador: "", departamento: "", tipo: "", estado: "", fecha: "" })
  const [editingRecord, setEditingRecord] = useState(null)
  const [editEstado, setEditEstado] = useState("")
  const [editObservaciones, setEditObservaciones] = useState("")
  const [editMotivo, setEditMotivo] = useState("")

  const canManageRecords = usuarioActual && ROLES_PERMITIDOS.includes(usuarioActual.rol)

  const stopStream = useCallback((stream) => {
    if (!stream) return
    stream.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // ignore stop errors
      }
    })
  }, [])

  const closeCamera = useCallback(() => {
    if (cameraStream) {
      stopStream(cameraStream)
      setCameraStream(null)
    }
    setCameraStatus("apagada")
    setCameraMessage("Cámara apagada")
  }, [cameraStream, stopStream])

  const updateCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoInputs = devices.filter((device) => device.kind === "videoinput")
      setAvailableCameras(videoInputs)
      if (videoInputs.length > 0 && !selectedCameraId) {
        setSelectedCameraId(videoInputs[0].deviceId)
      }
      return videoInputs
    } catch (error) {
      console.error("Error al enumerar cámaras:", error)
      return []
    }
  }, [selectedCameraId])

  const openCamera = useCallback(async (deviceId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Tu navegador no permite acceder a la cámara. Usa un navegador compatible o revisa los permisos.")
      setCameraMessage("Cámara no soportada")
      setCameraStatus("apagada")
      return
    }

    if (cameraStream) {
      stopStream(cameraStream)
      setCameraStream(null)
    }

    const videoInputs = await updateCameraDevices()
    if (videoInputs.length === 0) {
      alert("No se encontró ninguna cámara disponible.")
      setCameraMessage("Cámara no encontrada")
      setCameraStatus("apagada")
      return
    }

    const targetDeviceId = deviceId || selectedCameraId
    const videoConstraints = targetDeviceId
      ? { deviceId: { exact: targetDeviceId } }
      : { facingMode: cameraFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
      setCameraStream(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        videoRef.current.playsInline = true
        videoRef.current.autoplay = true
        await videoRef.current.play()
      }
      setCameraStatus("activa")
      setCameraMessage("Cámara activa")
    } catch (error) {
      console.error("Error al iniciar la cámara:", error)
      if (targetDeviceId && (error.name === "OverconstrainedError" || error.name === "NotFoundError")) {
        alert("No se pudo usar la cámara seleccionada. Intentando con una configuración más simple...")
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          setCameraStream(fallbackStream)
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream
            videoRef.current.muted = true
            videoRef.current.playsInline = true
            videoRef.current.autoplay = true
            await videoRef.current.play()
          }
          setCameraStatus("activa")
          setCameraMessage("Cámara activa (fallback)")
          return
        } catch (fallbackError) {
          console.error("Error fallback al iniciar la cámara:", fallbackError)
        }
      }

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        alert("Permiso de cámara denegado. Por favor habilita el acceso a la cámara en la configuración de tu navegador.")
        setCameraMessage("Permiso denegado")
      } else if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
        alert("No se encontró ninguna cámara disponible.")
        setCameraMessage("Cámara no encontrada")
      } else {
        alert(`No se pudo iniciar la cámara: ${error.message || "error desconocido"}`)
        setCameraMessage("Error al abrir cámara")
      }
      setCameraStatus("apagada")
    }
  }, [cameraFacingMode, cameraStream, selectedCameraId, stopStream, updateCameraDevices])

  const switchCamera = useCallback(async () => {
    if (availableCameras.length <= 1) {
      alert("No se puede cambiar de cámara: solo hay una cámara disponible.")
      return
    }
    const currentIndex = availableCameras.findIndex((device) => device.deviceId === selectedCameraId)
    const nextIndex = currentIndex < 0 || currentIndex === availableCameras.length - 1 ? 0 : currentIndex + 1
    const nextDeviceId = availableCameras[nextIndex].deviceId
    setSelectedCameraId(nextDeviceId)
    await openCamera(nextDeviceId)
  }, [availableCameras, selectedCameraId, openCamera])

  useEffect(() => {
    updateCameraDevices()
  }, [updateCameraDevices])

  useEffect(() => {
    return () => {
      closeCamera()
    }
  }, [closeCamera])

  useEffect(() => {
    localStorage.setItem("attendanceRecords", JSON.stringify(attendanceRecords))
  }, [attendanceRecords])

  useEffect(() => {
    localStorage.setItem("attendanceAudits", JSON.stringify(auditRecords))
  }, [auditRecords])

  const parseTime = useCallback((timeString) => {
    const [hours, minutes] = (timeString || "09:00").split(":").map(Number)
    const now = new Date()
    now.setHours(hours, minutes, 0, 0)
    return now
  }, [])

  const getUserById = useCallback((id) => {
    return usuarios?.find((user) => user.id === id) || null
  }, [usuarios])

  const getScheduleForUser = useCallback((usuarioId) => {
    const user = getUserById(usuarioId)
    const turnos = user?.turnos || usuarioActual?.turnos || []
    if (turnos.length > 0) {
      return turnos[0]
    }
    return { entrada: "09:00", salida: "17:00" }
  }, [getUserById, usuarioActual])

  const getOpenSession = useCallback((usuarioId) => {
    const entradas = attendanceRecords
      .filter((record) => record.usuarioId === usuarioId && record.tipoMarcaje === "Entrada")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    for (const entrada of entradas) {
      const tieneSalida = attendanceRecords.some(
        (record) => record.sessionId === entrada.sessionId && record.tipoMarcaje === "Salida"
      )
      if (!tieneSalida) {
        return entrada
      }
    }
    return null
  }, [attendanceRecords])

  const getOpenBathroom = useCallback((sessionId) => {
    const openIda = attendanceRecords
      .filter((record) => record.sessionId === sessionId && record.tipoMarcaje === "Ida al baño")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .find((ida) => !attendanceRecords.some((record) => record.relatedId === ida.id && record.tipoMarcaje === "Regreso del baño"))
    return openIda || null
  }, [attendanceRecords])

  const getBathroomTrips = useCallback((sessionId) => {
    return attendanceRecords.filter((record) => record.sessionId === sessionId && record.tipoMarcaje === "Ida al baño").length
  }, [attendanceRecords])

  const getBathroomMinutes = useCallback((sessionId) => {
    const idas = attendanceRecords.filter((record) => record.sessionId === sessionId && record.tipoMarcaje === "Ida al baño")
    return idas.reduce((total, ida) => {
      const regreso = attendanceRecords.find(
        (record) => record.relatedId === ida.id && record.tipoMarcaje === "Regreso del baño"
      )
      if (!regreso) return total
      const diff = (new Date(regreso.createdAt) - new Date(ida.createdAt)) / 60000
      return total + Math.max(0, Math.round(diff))
    }, 0)
  }, [attendanceRecords])

  const formatDuration = useCallback((minutes) => {
    const hrs = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hrs}h ${mins}m`
  }, [])

  const getSessionSummary = useMemo(() => {
    return attendanceRecords
      .filter((record) => record.tipoMarcaje === "Entrada")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((entrada) => {
        const salida = attendanceRecords.find(
          (record) => record.sessionId === entrada.sessionId && record.tipoMarcaje === "Salida"
        )
        const bathroomTrips = getBathroomTrips(entrada.sessionId)
        const totalBathroomMinutes = getBathroomMinutes(entrada.sessionId)
        const exceededBathroom = attendanceRecords.some(
          (record) => record.sessionId === entrada.sessionId && record.tipoMarcaje === "Regreso del baño" && record.estado === "Baño excedido"
        )
        const horasTrabajadas = salida ? Math.round((new Date(salida.createdAt) - new Date(entrada.createdAt)) / 60000) : 0
        return {
          sessionId: entrada.sessionId,
          usuarioId: entrada.usuarioId,
          nombre: entrada.nombre,
          departamento: entrada.departamento,
          fecha: entrada.fecha,
          entradaHora: entrada.horaExacta,
          entradaFoto: entrada.foto,
          salidaHora: salida?.horaExacta || "-",
          salidaFoto: salida?.foto || "",
          horasTrabajadas: salida ? formatDuration(horasTrabajadas) : "En curso",
          estadoJornada: salida ? salida.estado : "En curso",
          bathroomTrips,
          totalBathroomMinutes: formatDuration(totalBathroomMinutes),
          huboBañosExcedidos: exceededBathroom ? "Sí" : "No",
          observaciones: [entrada.observaciones, salida?.observaciones].filter(Boolean).join(" | ")
        }
      })
  }, [attendanceRecords, formatDuration, getBathroomMinutes, getBathroomTrips])

  const filteredAttendance = useMemo(() => {
    return attendanceRecords.filter((record) => {
      const matchesColaborador = filters.colaborador
        ? record.nombre.toLowerCase().includes(filters.colaborador.toLowerCase())
        : true
      const matchesDepartamento = filters.departamento
        ? record.departamento.toLowerCase().includes(filters.departamento.toLowerCase())
        : true
      const matchesTipo = filters.tipo ? record.tipoMarcaje === filters.tipo : true
      const matchesEstado = filters.estado ? record.estado === filters.estado : true
      const matchesFecha = filters.fecha ? record.fechaISO === filters.fecha : true
      return matchesColaborador && matchesDepartamento && matchesTipo && matchesEstado && matchesFecha
    })
  }, [attendanceRecords, filters])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) {
      setAlertMessage("No hay video disponible para capturar la foto.")
      return
    }
    const video = videoRef.current
    const canvas = canvasRef.current
    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      setAlertMessage("No se pudo obtener el contexto del canvas.")
      return
    }
    context.drawImage(video, 0, 0, width, height)
    const imageData = canvas.toDataURL("image/jpeg", 0.92)
    setPhotoPreview(imageData)
    setCameraMessage("Foto capturada")
  }, [])

  const getDeviceLabel = useCallback(() => {
    if (cameraStream) {
      const track = cameraStream.getVideoTracks()[0]
      return track?.label || navigator.userAgent || "Desconocido"
    }
    return navigator.userAgent || "Desconocido"
  }, [cameraStream])

  const setTab = useCallback((tab) => {
    if ((tab === "marcajes" || tab === "planilla") && !canManageRecords) {
      setAttendanceTab("registro")
      setAlertMessage("No tienes permisos para ver los marcajes de asistencia.")
      return
    }
    setAttendanceTab(tab)
    setAlertMessage("")
  }, [canManageRecords])

  const createListRecord = useCallback(() => {
    if (!usuarioActual) {
      alert("Debes iniciar sesión para guardar un marcaje.")
      return
    }
    if (!photoPreview) {
      alert("Debes tomar una foto antes de guardar el marcaje.")
      return
    }

    const now = new Date()
    const fechaISO = now.toISOString().slice(0, 10)
    const horaExacta = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    const schedule = getScheduleForUser(usuarioActual.id)
    const entradaProgramada = parseTime(schedule.entrada)
    const salidaProgramada = parseTime(schedule.salida)
    const openSession = getOpenSession(usuarioActual.id)
    const sessionId = selectedTipo === "Entrada" ? `${Date.now()}-${usuarioActual.id}` : openSession?.sessionId
    const baseRecord = {
      id: Date.now(),
      usuarioId: usuarioActual.id,
      username: usuarioActual.username,
      nombre: usuarioActual.nombre,
      rol: usuarioActual.rol,
      departamento: usuarioActual.departamento || "Sin departamento",
      tipoMarcaje: selectedTipo,
      fecha: now.toLocaleDateString(),
      fechaISO,
      horaExacta,
      foto: photoPreview,
      estado: "Registrado",
      observaciones: observaciones.trim(),
      dispositivo: getDeviceLabel(),
      creadoEn: now.toLocaleString(),
      createdAt: now.toISOString(),
      sessionId,
      relatedId: null
    }

    if (selectedTipo === "Entrada") {
      if (openSession) {
        alert("Ya existe una entrada abierta sin salida.")
        return
      }
      if (now < entradaProgramada) {
        baseRecord.estado = "Entrada temprana"
        setAlertMessage("Estás marcando entrada antes de tu horario programado.")
      } else if (now > entradaProgramada) {
        baseRecord.estado = "Entrada tarde"
        setAlertMessage("Estás marcando entrada tarde.")
      } else {
        baseRecord.estado = "Entrada a tiempo"
      }
    }

    if (selectedTipo === "Salida") {
      if (!openSession) {
        alert("No hay una entrada abierta para marcar salida.")
        setAlertMessage("Intento de salida sin entrada")
        return
      }
      baseRecord.sessionId = openSession.sessionId
      const entradaTime = new Date(openSession.createdAt)
      const diffMinutes = Math.max(0, Math.round((now - entradaTime) / 60000))
      baseRecord.horasTrabajadas = diffMinutes
      if (now < salidaProgramada) {
        baseRecord.estado = "Salida anticipada"
        setAlertMessage("Estás marcando salida antes de tu horario programado.")
      } else if (now >= salidaProgramada && now <= new Date(salidaProgramada.getTime() + 15 * 60000)) {
        baseRecord.estado = "Jornada completa"
      } else {
        baseRecord.estado = "Salida después de horario"
        setAlertMessage("Estás marcando salida después de tu horario programado.")
      }
      baseRecord.observaciones = baseRecord.observaciones || "Salida asociada a entrada abierta"
    }

    if (selectedTipo === "Ida al baño") {
      if (!openSession) {
        alert("Debe haber una entrada abierta para ir al baño.")
        setAlertMessage("Intento de ida al baño sin entrada abierta")
        return
      }
      const openBathroom = getOpenBathroom(openSession.sessionId)
      const trips = getBathroomTrips(openSession.sessionId)
      if (openBathroom) {
        alert("Ya tienes una ida al baño abierta sin regreso.")
        return
      }
      if (trips >= 2) {
        alert("Ya utilizaste las 2 idas al baño permitidas para este turno.")
        setAlertMessage("Ya utilizaste las 2 idas al baño permitidas para este turno.")
        return
      }
      baseRecord.sessionId = openSession.sessionId
      baseRecord.estado = "Ida al baño registrada"
    }

    if (selectedTipo === "Regreso del baño") {
      if (!openSession) {
        alert("Debe haber una entrada abierta para regresar del baño.")
        setAlertMessage("Intento de regreso del baño sin ida previa")
        return
      }
      const openBathroom = getOpenBathroom(openSession.sessionId)
      if (!openBathroom) {
        alert("No hay una ida al baño abierta para regresar.")
        setAlertMessage("Intento de regreso del baño sin ida previa")
        return
      }
      baseRecord.sessionId = openSession.sessionId
      baseRecord.relatedId = openBathroom.id
      const minutesUsed = Math.max(0, Math.round((new Date() - new Date(openBathroom.createdAt)) / 60000))
      baseRecord.duracionBanio = minutesUsed
      if (minutesUsed <= 10) {
        baseRecord.estado = "Baño dentro del tiempo permitido"
      } else {
        baseRecord.estado = "Baño excedido"
        setAlertMessage("Baño excedido")
      }
      baseRecord.observaciones = baseRecord.observaciones || `Tiempo en baño: ${minutesUsed} min`
    }

    setAttendanceRecords((prev) => [baseRecord, ...prev])
    setPhotoPreview("")
    setObservaciones("")
    setSaving(false)
  }, [photoPreview, selectedTipo, observaciones, usuarioActual, getScheduleForUser, getOpenSession, getOpenBathroom, getBathroomTrips, getDeviceLabel])

  const handleEditRecord = useCallback((record) => {
    setEditingRecord(record)
    setEditEstado(record.estado)
    setEditObservaciones(record.observaciones || "")
    setEditMotivo("")
  }, [])

  const saveEditRecord = useCallback(() => {
    if (!editingRecord) return
    if (!editMotivo.trim()) {
      alert("Motivo de corrección obligatorio.")
      return
    }
    const updatedRecord = {
      ...editingRecord,
      estado: editEstado,
      observaciones: editObservaciones.trim()
    }
    setAttendanceRecords((prev) => prev.map((record) => (record.id === editingRecord.id ? updatedRecord : record)))
    setAuditRecords((prev) => [
      {
        id: Date.now(),
        recordId: editingRecord.id,
        quien: usuarioActual?.nombre || "Desconocido",
        quienRol: usuarioActual?.rol || "Desconocido",
        fechaHora: new Date().toLocaleString(),
        motivo: editMotivo.trim(),
        anterior: {
          estado: editingRecord.estado,
          observaciones: editingRecord.observaciones
        },
        nuevo: {
          estado: editEstado,
          observaciones: editObservaciones.trim()
        }
      },
      ...prev
    ])
    setEditingRecord(null)
    setEditMotivo("")
    setAlertMessage("Registro corregido y auditoría guardada.")
  }, [editingRecord, editEstado, editObservaciones, editMotivo, usuarioActual])

  const downloadAttendancePdf = useCallback(() => {
    const pdf = new jsPDF({ orientation: "landscape" })
    pdf.setFontSize(16)
    pdf.text("Reporte de Marcajes de Asistencia", 14, 18)
    const fechaInicial = filters.fecha || attendanceRecords[attendanceRecords.length - 1]?.fechaISO || ""
    const fechaFinal = filters.fecha || attendanceRecords[0]?.fechaISO || ""
    pdf.setFontSize(10)
    pdf.text(`Rango de fechas: ${fechaInicial} - ${fechaFinal}`, 14, 26)

    const rows = filteredAttendance.map((record) => [
      record.nombre,
      record.departamento,
      record.tipoMarcaje,
      record.fecha,
      record.horaExacta,
      record.estado,
      record.observaciones || ""
    ])

    autoTable(pdf, {
      head: [["Empleado", "Departamento", "Tipo", "Fecha", "Hora", "Estado", "Observaciones"]],
      body: rows,
      startY: 32,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 }
    })

    const pageHeight = pdf.internal.pageSize.height
    pdf.text("Firma RRHH:", 14, pageHeight - 20)
    pdf.text("Firma Gerencia:", 120, pageHeight - 20)
    pdf.save("marcajes_asistencia.pdf")
  }, [filteredAttendance, attendanceRecords, filters.fecha])

  const tabButtons = [
    { key: "registro", label: "Registrar marcaje" },
    ...(canManageRecords ? [{ key: "marcajes", label: "Marcajes de Asistencia" }, { key: "planilla", label: "Control de Planilla" }] : [])
  ]

  return (
    <div style={{ display: "grid", gap: "18px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {tabButtons.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            style={{
              ...buttonStyle,
              backgroundColor: attendanceTab === tab.key ? "#2563eb" : "#1f2937",
              minWidth: "180px"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {alertMessage && (
        <div style={{ backgroundColor: "#831843", color: "#f8fafc", padding: "12px 16px", borderRadius: "12px" }}>
          {alertMessage}
        </div>
      )}

      {attendanceTab === "registro" && (
        <div style={{ display: "grid", gap: "20px" }}>
          <div style={{ display: "grid", gap: "14px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
              <div style={{ padding: "10px 14px", borderRadius: "999px", backgroundColor: cameraStatus === "activa" ? "#16a34a" : "#6b7280", color: "white" }}>
                Cámara: {cameraStatus === "activa" ? "Activo" : "Apagada"}
              </div>
              <div style={{ color: cameraStatus === "activa" ? "#d1fae5" : "#fca5a5" }}>{cameraMessage}</div>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ display: "grid", gap: "10px", width: "100%", maxWidth: "640px" }}>
                <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", backgroundColor: "#000", borderRadius: "16px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <video
                    ref={videoRef}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    autoPlay
                    playsInline
                    muted
                  />
                  {cameraStatus !== "activa" && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#f8fafc", backgroundColor: "rgba(0,0,0,0.35)" }}>
                      Cámara lista para iniciar
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} style={{ display: "none" }} />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                <button type="button" onClick={() => openCamera()} style={{ ...buttonStyle, backgroundColor: "#2563eb" }}>
                  Iniciar cámara
                </button>
                <button type="button" onClick={capturePhoto} style={{ ...buttonStyle, backgroundColor: "#f59e0b" }}>
                  Capturar foto
                </button>
                <button type="button" onClick={closeCamera} style={{ ...buttonStyle, backgroundColor: "#6b7280" }}>
                  Cerrar cámara
                </button>
                <button type="button" onClick={switchCamera} style={{ ...buttonStyle, backgroundColor: availableCameras.length > 1 ? "#9333ea" : "#4b5563" }} disabled={availableCameras.length <= 1}>
                  Cambiar cámara
                </button>
              </div>

              {availableCameras.length > 0 && (
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ color: "#cbd5e1", minWidth: "140px" }}>Seleccionar cámara:</label>
                  <select
                    value={selectedCameraId}
                    onChange={(e) => setSelectedCameraId(e.target.value)}
                    style={{ padding: "10px 14px", borderRadius: "10px", border: "1px solid #334155", backgroundColor: "#0f1724", color: "white", minWidth: "250px" }}
                  >
                    {availableCameras.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${availableCameras.indexOf(device) + 1}`}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: "14px", maxWidth: "640px" }}>
            <div style={{ display: "grid", gap: "10px" }}>
              <label style={fieldLabelStyle}>Tipo de marcaje</label>
              <select value={selectedTipo} onChange={(e) => setSelectedTipo(e.target.value)} style={inputStyle}>
                {TIPOS_MARCAJE.map((tipo) => (
                  <option key={tipo} value={tipo}>{tipo}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: "10px" }}>
              <label style={fieldLabelStyle}>Observaciones</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
                placeholder="Escribe alguna nota o motivo adicional..."
              />
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
              <button type="button" onClick={createListRecord} style={{ ...buttonStyle, backgroundColor: "#16a34a" }} disabled={!photoPreview || saving}>
                Guardar marcaje
              </button>
              {!photoPreview && <span style={{ color: "#fca5a5" }}>Se necesita una foto para guardar.</span>}
            </div>
          </div>

          {photoPreview && (
            <div style={{ backgroundColor: "#111827", borderRadius: "16px", padding: "14px", border: "1px solid #374151", maxWidth: "640px" }}>
              <p style={{ margin: "0 0 8px", fontWeight: 700 }}>Vista previa de la foto</p>
              <img src={photoPreview} alt="Foto de marcaje" style={{ width: "100%", borderRadius: "12px", objectFit: "contain" }} />
            </div>
          )}
        </div>
      )}

      {attendanceTab === "marcajes" && (
        <div style={{ display: "grid", gap: "18px" }}>
          <div style={{ display: "grid", gap: "16px", maxWidth: "100%" }}>
            <h3 style={{ margin: 0 }}>Filtros de marcajes</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
              <input type="text" value={filters.colaborador} placeholder="Filtrar por colaborador" onChange={(e) => setFilters((s) => ({ ...s, colaborador: e.target.value }))} style={inputStyle} />
              <input type="text" value={filters.departamento} placeholder="Filtrar por departamento" onChange={(e) => setFilters((s) => ({ ...s, departamento: e.target.value }))} style={inputStyle} />
              <select value={filters.tipo} onChange={(e) => setFilters((s) => ({ ...s, tipo: e.target.value }))} style={inputStyle}>
                <option value="">Todos los tipos</option>
                {TIPOS_MARCAJE.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
              </select>
              <select value={filters.estado} onChange={(e) => setFilters((s) => ({ ...s, estado: e.target.value }))} style={inputStyle}>
                <option value="">Todos los estados</option>
                <option value="Entrada a tiempo">Entrada a tiempo</option>
                <option value="Entrada temprana">Entrada temprana</option>
                <option value="Entrada tarde">Entrada tarde</option>
                <option value="Salida registrada">Salida registrada</option>
                <option value="Salida anticipada">Salida anticipada</option>
                <option value="Salida después de horario">Salida después de horario</option>
                <option value="Jornada completa">Jornada completa</option>
                <option value="Baño dentro del tiempo permitido">Baño dentro del tiempo permitido</option>
                <option value="Baño excedido">Baño excedido</option>
              </select>
              <input type="date" value={filters.fecha} onChange={(e) => setFilters((s) => ({ ...s, fecha: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button type="button" onClick={downloadAttendancePdf} style={{ ...buttonStyle, backgroundColor: "#0f766e" }}>
              Descargar PDF
            </button>
          </div>

          {filteredAttendance.length === 0 ? (
            <div style={{ padding: "18px", borderRadius: "16px", backgroundColor: "#111827", border: "1px solid #374151" }}>
              <p style={{ margin: 0, color: "#cbd5e1" }}>No se encontraron marcajes con estos filtros.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#111827" }}>
                    <th style={tableHead}>Nombre</th>
                    <th style={tableHead}>Departamento</th>
                    <th style={tableHead}>Tipo</th>
                    <th style={tableHead}>Fecha</th>
                    <th style={tableHead}>Hora</th>
                    <th style={tableHead}>Estado</th>
                    <th style={tableHead}>Observaciones</th>
                    <th style={tableHead}>Foto</th>
                    {canManageRecords && <th style={tableHead}>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendance.map((record) => (
                    <tr key={record.id} style={{ borderBottom: "1px solid #1f2937" }}>
                      <td style={tableCell}>{record.nombre}</td>
                      <td style={tableCell}>{record.departamento}</td>
                      <td style={tableCell}>{record.tipoMarcaje}</td>
                      <td style={tableCell}>{record.fecha}</td>
                      <td style={tableCell}>{record.horaExacta}</td>
                      <td style={tableCell}>{record.estado}</td>
                      <td style={tableCell}>{record.observaciones}</td>
                      <td style={tableCell}><img src={record.foto} alt="Marcaje" style={{ width: "80px", borderRadius: "10px" }} /></td>
                      {canManageRecords && (
                        <td style={tableCell}>
                          <button type="button" onClick={() => handleEditRecord(record)} style={{ ...buttonStyle, backgroundColor: "#2563eb", minWidth: "auto", padding: "8px 12px" }}>
                            Corregir
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editingRecord && (
            <div style={{ backgroundColor: "#0f172a", padding: "18px", borderRadius: "16px", border: "1px solid #374151" }}>
              <h4 style={{ margin: "0 0 12px" }}>Corregir marcaje</h4>
              <div style={{ display: "grid", gap: "12px", maxWidth: "640px" }}>
                <div>
                  <label style={fieldLabelStyle}>Estado</label>
                  <input value={editEstado} onChange={(e) => setEditEstado(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Observaciones</label>
                  <textarea value={editObservaciones} onChange={(e) => setEditObservaciones(e.target.value)} style={{ ...inputStyle, minHeight: "80px" }} />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Motivo de corrección</label>
                  <textarea value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} style={{ ...inputStyle, minHeight: "60px" }} />
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button type="button" onClick={saveEditRecord} style={{ ...buttonStyle, backgroundColor: "#16a34a" }}>
                    Guardar corrección
                  </button>
                  <button type="button" onClick={() => setEditingRecord(null)} style={{ ...buttonStyle, backgroundColor: "#6b7280" }}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {attendanceTab === "planilla" && (
        <div style={{ display: "grid", gap: "18px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <div style={summaryCard}>
              <h3 style={{ margin: 0 }}>Sesiones totales</h3>
              <p style={{ margin: "10px 0 0", fontSize: "1.1rem" }}>{getSessionSummary.length}</p>
            </div>
            <div style={summaryCard}>
              <h3 style={{ margin: 0 }}>Marcajes registrados</h3>
              <p style={{ margin: "10px 0 0", fontSize: "1.1rem" }}>{attendanceRecords.length}</p>
            </div>
            <div style={summaryCard}>
              <h3 style={{ margin: 0 }}>Baños excedidos</h3>
              <p style={{ margin: "10px 0 0", fontSize: "1.1rem" }}>{attendanceRecords.filter((record) => record.estado === "Baño excedido").length}</p>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
              <thead>
                <tr style={{ backgroundColor: "#111827" }}>
                  <th style={tableHead}>Nombre</th>
                  <th style={tableHead}>Departamento</th>
                  <th style={tableHead}>Fecha</th>
                  <th style={tableHead}>Hora entrada</th>
                  <th style={tableHead}>Foto entrada</th>
                  <th style={tableHead}>Hora salida</th>
                  <th style={tableHead}>Foto salida</th>
                  <th style={tableHead}>Horas trabajadas</th>
                  <th style={tableHead}>Estado jornada</th>
                  <th style={tableHead}>Idas al baño</th>
                  <th style={tableHead}>Tiempo en baño</th>
                  <th style={tableHead}>Baños excedidos</th>
                  <th style={tableHead}>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {getSessionSummary.map((session) => (
                  <tr key={session.sessionId} style={{ borderBottom: "1px solid #1f2937" }}>
                    <td style={tableCell}>{session.nombre}</td>
                    <td style={tableCell}>{session.departamento}</td>
                    <td style={tableCell}>{session.fecha}</td>
                    <td style={tableCell}>{session.entradaHora}</td>
                    <td style={tableCell}><img src={session.entradaFoto} alt="Entrada" style={{ width: "80px", borderRadius: "10px" }} /></td>
                    <td style={tableCell}>{session.salidaHora}</td>
                    <td style={tableCell}>{session.salidaFoto ? <img src={session.salidaFoto} alt="Salida" style={{ width: "80px", borderRadius: "10px" }} /> : "-"}</td>
                    <td style={tableCell}>{session.horasTrabajadas}</td>
                    <td style={tableCell}>{session.estadoJornada}</td>
                    <td style={tableCell}>{session.bathroomTrips}</td>
                    <td style={tableCell}>{session.totalBathroomMinutes}</td>
                    <td style={tableCell}>{session.huboBañosExcedidos}</td>
                    <td style={tableCell}>{session.observaciones || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const buttonStyle = {
  color: "white",
  padding: "10px 16px",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  minWidth: "140px"
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f1724",
  color: "white"
}

const fieldLabelStyle = {
  marginBottom: "6px",
  color: "#cbd5e1",
  display: "block"
}

const tableHead = {
  padding: "12px 14px",
  textAlign: "left",
  color: "#e2e8f0",
  fontSize: "0.9rem",
  borderBottom: "1px solid #1f2937"
}

const tableCell = {
  padding: "12px 14px",
  color: "#cbd5e1",
  verticalAlign: "top",
  fontSize: "0.9rem"
}

const summaryCard = {
  backgroundColor: "#111827",
  borderRadius: "16px",
  padding: "18px",
  border: "1px solid #374151",
  minWidth: "180px"
}

export default AttendanceCamera

