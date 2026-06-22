import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import { supabase } from "../../lib/supabase"
import { getActiveAreas } from "../../services/areasService"
import { canCreateUserRole, PROFILE_ROLES } from "../../utils/profilePermissions"
import { convertRecruitmentCandidateToEmployee } from "./recruitmentService"
import {
  CONTRACT_TYPES,
  emptyConversionForm,
  labelFor,
  ONBOARDING_STATUSES,
  VACANCY_REASONS
} from "./recruitmentUtils"

function Field({ label, className = "", children }) {
  return (
    <label className={`recruitment-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "")
}

function suggestUsername(fullName, email) {
  const emailBase = String(email || "").split("@")[0]
  const nameBase = String(fullName || "usuario")
  return normalizeUsername(emailBase || nameBase) || `usuario${Date.now().toString().slice(-6)}`
}

export default function ConvertCandidateModal({
  open,
  onClose,
  candidateId,
  detail,
  profiles = [],
  onSuccess,
  onMessage
}) {
  const { user } = useAuth()
  const candidate = detail?.candidate || {}
  const vacancy = detail?.vacancy || {}
  const alreadyConverted = Boolean(candidate.profile_id)

  const [form, setForm] = useState(() => emptyConversionForm(detail))
  const [areas, setAreas] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setForm(emptyConversionForm(detail))
    setError("")
    getActiveAreas().then(({ data }) => setAreas(Array.isArray(data) ? data : []))
  }, [open, detail])

  const roleOptions = useMemo(
    () => PROFILE_ROLES.filter((role) => canCreateUserRole(user, role)),
    [user]
  )

  if (!open) return null

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function handleAreaChange(areaId) {
    const area = areas.find((item) => item.id === areaId)
    setForm((current) => ({
      ...current,
      area_id: areaId,
      area: area?.name || current.area
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (alreadyConverted) {
      onMessage?.("Este candidato ya fue convertido a colaborador.", "error")
      return
    }
    if (!form.hire_date) {
      setError("La fecha de ingreso es obligatoria.")
      return
    }
    if (!form.final_position?.trim()) {
      setError("El puesto final es obligatorio.")
      return
    }

    setSaving(true)
    setError("")

    let profileId = form.existing_profile_id || ""

    try {
      if (form.create_erp_user) {
        if (!form.email?.trim() || !form.password || form.password.length < 6) {
          throw new Error("Correo y contraseña (mín. 6 caracteres) son obligatorios para crear usuario.")
        }
        if (!canCreateUserRole(user, form.erp_role)) {
          throw new Error("No tienes permiso para asignar ese rol.")
        }
        const username = normalizeUsername(form.username || suggestUsername(candidate.full_name, form.email))
        const { data, error: createError } = await supabase.functions.invoke("create-user", {
          body: {
            email: form.email.trim(),
            password: form.password,
            profile: {
              full_name: candidate.full_name?.trim(),
              username,
              role: form.erp_role,
              area_id: form.area_id || null,
              area_name: form.area || null,
              employee_id: form.employee_id?.trim() || null,
              phone: candidate.phone?.trim() || null,
              status: form.profile_status
            }
          }
        })
        if (createError) throw new Error(createError.message || "No se pudo crear el usuario ERP.")
        profileId = data?.user_id
        if (!profileId) throw new Error("Usuario creado pero no se obtuvo el identificador del colaborador.")
      } else if (!profileId) {
        throw new Error("Selecciona un colaborador existente o activa «Crear usuario ERP».")
      }

      const payload = {
        hire_date: form.hire_date,
        area: form.area,
        area_id: form.area_id || null,
        final_position: form.final_position,
        erp_role: form.erp_role,
        contract_type: form.contract_type,
        agreed_salary: form.agreed_salary,
        initial_schedule: form.initial_schedule,
        supervisor_profile_id: form.supervisor_profile_id || null,
        create_expediente: form.create_expediente,
        create_onboarding: form.create_onboarding,
        employee_id: form.employee_id?.trim() || null,
        profile_status: form.profile_status,
        hire_reason: form.hire_reason
      }

      const result = await convertRecruitmentCandidateToEmployee(candidateId, profileId, payload)
      if (result.error) throw new Error(result.error)

      onMessage?.("Colaborador creado e incorporación iniciada.", "success")
      onSuccess?.(result.data)
      onClose?.()
    } catch (submitError) {
      const message = submitError?.message || "Error al convertir candidato."
      setError(message)
      onMessage?.(message, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="recruitment-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="recruitment-modal recruitment-modal--wide" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div>
          <h2>Contratar y convertir en colaborador</h2>
          <p className="tasks-muted">
            {candidate.full_name || "Candidato"} · {vacancy.position_title || "Sin vacante"}
          </p>
          {candidate.onboarding_status ? (
            <span className={`recruitment-badge recruitment-badge--default`}>
              {labelFor(ONBOARDING_STATUSES, candidate.onboarding_status)}
            </span>
          ) : null}
        </div>

        {error ? <p className="recruitment-message error">{error}</p> : null}

        <div className="recruitment-form-grid">
          <Field label="Fecha de ingreso">
            <input type="date" value={form.hire_date} onChange={(e) => updateField("hire_date", e.target.value)} required />
          </Field>
          <Field label="Área">
            <select value={form.area_id} onChange={(e) => handleAreaChange(e.target.value)}>
              <option value="">Manual / sin catálogo</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>{area.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Nombre de área">
            <input value={form.area} onChange={(e) => updateField("area", e.target.value)} />
          </Field>
          <Field label="Puesto final">
            <input value={form.final_position} onChange={(e) => updateField("final_position", e.target.value)} required />
          </Field>
          <Field label="Rol ERP">
            <select value={form.erp_role} onChange={(e) => updateField("erp_role", e.target.value)}>
              {roleOptions.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de contrato">
            <select value={form.contract_type} onChange={(e) => updateField("contract_type", e.target.value)}>
              {CONTRACT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Salario / base acordada">
            <input value={form.agreed_salary} onChange={(e) => updateField("agreed_salary", e.target.value)} />
          </Field>
          <Field label="Horario inicial">
            <input value={form.initial_schedule} onChange={(e) => updateField("initial_schedule", e.target.value)} />
          </Field>
          <Field label="Supervisor responsable">
            <select value={form.supervisor_profile_id} onChange={(e) => updateField("supervisor_profile_id", e.target.value)}>
              <option value="">Sin asignar</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
              ))}
            </select>
          </Field>
          <Field label="Motivo de contratación">
            <select value={form.hire_reason} onChange={(e) => updateField("hire_reason", e.target.value)}>
              {VACANCY_REASONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="ID empleado (opcional)">
            <input value={form.employee_id} onChange={(e) => updateField("employee_id", e.target.value)} />
          </Field>
        </div>

        <div className="recruitment-conversion-flags">
          <label>
            <input type="checkbox" checked={form.create_erp_user} onChange={(e) => updateField("create_erp_user", e.target.checked)} />
            Crear usuario ERP
          </label>
          <label>
            <input type="checkbox" checked={form.create_expediente} onChange={(e) => updateField("create_expediente", e.target.checked)} />
            Crear expediente
          </label>
          <label>
            <input type="checkbox" checked={form.create_onboarding} onChange={(e) => updateField("create_onboarding", e.target.checked)} />
            Crear onboarding
          </label>
        </div>

        {form.create_erp_user ? (
          <div className="recruitment-form-grid">
            <Field label="Correo ERP" className="recruitment-field--full">
              <input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} required={form.create_erp_user} />
            </Field>
            <Field label="Usuario sugerido">
              <input
                value={form.username || suggestUsername(candidate.full_name, form.email)}
                onChange={(e) => updateField("username", e.target.value)}
                placeholder={suggestUsername(candidate.full_name, form.email)}
              />
            </Field>
            <Field label="Contraseña temporal">
              <input type="password" value={form.password} onChange={(e) => updateField("password", e.target.value)} required={form.create_erp_user} minLength={6} />
            </Field>
            <Field label="Estado inicial">
              <select value={form.profile_status} onChange={(e) => updateField("profile_status", e.target.value)}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </Field>
          </div>
        ) : (
          <Field label="Colaborador existente" className="recruitment-field--full">
            <select value={form.existing_profile_id} onChange={(e) => updateField("existing_profile_id", e.target.value)} required={!form.create_erp_user}>
              <option value="">Seleccionar colaborador...</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
              ))}
            </select>
          </Field>
        )}

        <div className="recruitment-modal__actions">
          <button type="button" className="tasks-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="tasks-primary" disabled={saving || alreadyConverted}>
            {saving ? "Procesando..." : "Confirmar contratación"}
          </button>
        </div>
      </form>
    </div>
  )
}
