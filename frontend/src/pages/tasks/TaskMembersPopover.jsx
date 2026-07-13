import { useEffect, useMemo, useState } from "react"
import { initialsForName } from "./taskCardUtils"
import "./operationalTasks.css"

function filterProfiles(profiles, query) {
  const term = String(query || "").trim().toLowerCase()
  if (!term) return profiles
  return profiles.filter((row) => {
    const haystack = [
      row.full_name,
      row.username,
      row.area_name,
      row.area_id
    ].filter(Boolean).join(" ").toLowerCase()
    return haystack.includes(term)
  })
}

export default function TaskMembersPopover({
  open = false,
  onClose,
  task,
  assignableProfiles = [],
  currentUserId = null,
  saving = false,
  onSave
}) {
  const [search, setSearch] = useState("")
  const [primaryId, setPrimaryId] = useState(null)
  const [participantIds, setParticipantIds] = useState([])
  const [watcherIds, setWatcherIds] = useState([])

  const permissions = task?.permissions || {}
  const canManageMembers = Boolean(permissions.manage_members)
  const canManageWatchers = Boolean(permissions.manage_watchers)

  useEffect(() => {
    if (!open || !task?.id) return
    const assignees = task.assignees || []
    const primary = assignees.find((row) => row.assignment_role === "primary") || assignees[0]
    setPrimaryId(primary?.profile_id || null)
    setParticipantIds(
      assignees
        .filter((row) => row.profile_id && row.profile_id !== primary?.profile_id)
        .map((row) => row.profile_id)
    )
    setWatcherIds((task.watchers || []).map((row) => row.profile_id).filter(Boolean))
    setSearch("")
  }, [open, task])

  const profilePool = useMemo(() => {
    const map = new Map()
    assignableProfiles.forEach((row) => map.set(row.id, row))
    ;(task?.assignees || []).forEach((row) => {
      if (row.profile_id && !map.has(row.profile_id)) {
        map.set(row.profile_id, {
          id: row.profile_id,
          full_name: row.full_name,
          area_name: row.area_name
        })
      }
    })
    ;(task?.watchers || []).forEach((row) => {
      if (row.profile_id && !map.has(row.profile_id)) {
        map.set(row.profile_id, {
          id: row.profile_id,
          full_name: row.full_name,
          area_name: row.area_name
        })
      }
    })
    if (currentUserId && !map.has(currentUserId)) {
      map.set(currentUserId, { id: currentUserId, full_name: "Tú", area_name: "" })
    }
    return [...map.values()]
  }, [assignableProfiles, task, currentUserId])

  const filteredProfiles = useMemo(
    () => filterProfiles(profilePool, search),
    [profilePool, search]
  )

  if (!open) return null

  function toggleParticipant(profileId) {
    if (!canManageMembers) return
    if (profileId === primaryId) return
    setParticipantIds((current) => (
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId]
    ))
  }

  function toggleWatcher(profileId) {
    const isAssignee = profileId === primaryId || participantIds.includes(profileId)
    if (isAssignee) return
    if (canManageWatchers) {
      setWatcherIds((current) => (
        current.includes(profileId)
          ? current.filter((id) => id !== profileId)
          : [...current, profileId]
      ))
      return
    }
    if (profileId !== currentUserId) return
    setWatcherIds((current) => (
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId]
    ))
  }

  function handlePrimaryChange(profileId) {
    if (!canManageMembers || !profileId) return
    setPrimaryId(profileId)
    setParticipantIds((current) => current.filter((id) => id !== profileId))
    setWatcherIds((current) => (current.includes(profileId) ? current : [...current, profileId]))
  }

  async function handleSave() {
    if (!primaryId && !permissions.watch_self) return
    const assignees = task?.assignees || []
    const currentPrimary = assignees.find((row) => row.assignment_role === "primary") || assignees[0]
    const currentParticipants = assignees
      .filter((row) => row.profile_id && row.profile_id !== currentPrimary?.profile_id)
      .map((row) => row.profile_id)

    await onSave?.({
      primaryId: canManageMembers ? primaryId : (currentPrimary?.profile_id || primaryId),
      participantIds: canManageMembers ? participantIds : currentParticipants,
      watcherIds: Array.from(new Set([
        ...(canManageMembers ? [primaryId] : [currentPrimary?.profile_id]).filter(Boolean),
        ...(canManageMembers ? participantIds : currentParticipants),
        ...watcherIds
      ]))
    })
  }

  const primaryProfile = assignableProfiles.find((row) => row.id === primaryId)
    || (task.assignees || []).find((row) => row.profile_id === primaryId)

  return (
    <div className="ot-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="ot-modal ot-members-modal erp-card erp-card--form"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Miembros de la tarea"
      >
        <header className="ot-detail-block__head">
          <span className="ot-detail-block__icon ot-detail-block__icon--team" aria-hidden="true" />
          <div>
            <h3 className="ot-detail-block__title">Miembros</h3>
            <p className="ot-detail-block__hint">Responsable, participantes y seguidores</p>
          </div>
        </header>

        <label className="ot-field ot-field--detail">
          <span>Buscar colaborador</span>
          <input
            className="ot-detail-control"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre o área"
          />
        </label>

        <section className="ot-members-modal__section">
          <p className="ot-detail-block__label">Responsable principal</p>
          {canManageMembers ? (
            <select
              className="ot-detail-control"
              value={primaryId || ""}
              onChange={(event) => handlePrimaryChange(event.target.value || null)}
              disabled={saving}
            >
              <option value="" disabled>Seleccionar responsable</option>
              {filteredProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name || profile.username || "Colaborador"}
                  {profile.area_name ? ` · ${profile.area_name}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="ot-detail-primary">
              <span className="ot-detail-primary__avatar ot-detail-primary__avatar--initials">
                {initialsForName(primaryProfile?.full_name)}
              </span>
              <div className="ot-detail-primary__meta">
                <strong>{primaryProfile?.full_name || "Sin asignar"}</strong>
                <span className="erp-badge ot-badge ot-badge--status">Responsable principal</span>
              </div>
            </div>
          )}
        </section>

        {canManageMembers ? (
          <section className="ot-members-modal__section">
            <p className="ot-detail-block__label">Participantes</p>
            <div className="ot-assignee-list ot-assignee-list--detail">
              {filteredProfiles
                .filter((profile) => profile.id !== primaryId)
                .map((profile) => (
                  <label key={profile.id} className="ot-assignee-option ot-assignee-option--detail">
                    <input
                      type="checkbox"
                      checked={participantIds.includes(profile.id)}
                      onChange={() => toggleParticipant(profile.id)}
                      disabled={saving}
                    />
                    <span>
                      <strong>{profile.full_name || profile.username || "Colaborador"}</strong>
                      {profile.area_name ? <small>{profile.area_name}</small> : null}
                    </span>
                  </label>
                ))}
              {!filteredProfiles.length ? (
                <p className="ot-muted">No hay colaboradores asignables para tu rol.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="ot-members-modal__section">
          <p className="ot-detail-block__label">Seguidores</p>
          <p className="ot-muted ot-members-modal__note">
            Reciben actualizaciones sin ser responsables de ejecutar la tarea.
          </p>
          <div className="ot-assignee-list ot-assignee-list--detail">
            {filteredProfiles.map((profile) => {
              const isAssignee = profile.id === primaryId || participantIds.includes(profile.id)
              const checked = isAssignee || watcherIds.includes(profile.id)
              const canToggle = isAssignee
                ? false
                : (canManageWatchers || profile.id === currentUserId)
              return (
                <label
                  key={`watch-${profile.id}`}
                  className={`ot-assignee-option ot-assignee-option--detail${isAssignee ? " is-locked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canToggle || saving}
                    onChange={() => toggleWatcher(profile.id)}
                  />
                  <span>
                    <strong>{profile.full_name || profile.username || "Colaborador"}</strong>
                    {isAssignee ? <small>Asignado automáticamente</small> : <small>Solo seguimiento</small>}
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <div className="ot-modal__actions">
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="ot-btn ot-btn--primary"
            onClick={handleSave}
            disabled={saving || !primaryId || (!canManageMembers && !permissions.watch_self)}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
