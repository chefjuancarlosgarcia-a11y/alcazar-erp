const MIN_DEACTIVATE_REASON_LENGTH = 3
const MAX_DEACTIVATE_REASON_LENGTH = 500

export function validateDeactivateReason(reason) {
  const trimmed = String(reason || "").trim()
  if (trimmed.length < MIN_DEACTIVATE_REASON_LENGTH || trimmed.length > MAX_DEACTIVATE_REASON_LENGTH) {
    return "El motivo de baja es obligatorio (3 a 500 caracteres)."
  }
  return ""
}

export function applyDeactivateAttemptStart(state) {
  return {
    ...state,
    deactivatingId: state.deactivateTarget?.id || "",
    deactivateModalError: ""
  }
}

export function applyDeactivateAttemptFinish(state, result) {
  if (!result?.ok) {
    return {
      ...state,
      deactivatingId: "",
      deactivateModalError: result?.message || "Error al guardar en la base de datos."
    }
  }

  return {
    ...state,
    deactivatingId: "",
    deactivateTarget: null,
    deactivateReason: "",
    deactivateModalError: "",
    pageMessage: result.data?.already_inactive
      ? "El usuario ya estaba dado de baja. Sesiones revocadas."
      : "Usuario dado de baja. Acceso y sesiones bloqueados."
  }
}

export function applyReactivateAttemptStart(state) {
  return {
    ...state,
    reactivatingId: state.reactivateTarget?.id || "",
    reactivateModalError: ""
  }
}

export function applyReactivateAttemptFinish(state, result) {
  if (!result?.ok) {
    return {
      ...state,
      reactivatingId: "",
      reactivateModalError: result?.message || "Error al guardar en la base de datos."
    }
  }

  return {
    ...state,
    reactivatingId: "",
    reactivateTarget: null,
    reactivateModalError: "",
    pageMessage: result.message || "Usuario reactivado."
  }
}

export function shouldKeepLifecycleModalOpen(result) {
  return !result?.ok
}
