import { supabase } from "../lib/supabase"

export async function getTaskAssignableProfiles() {
  const result = await supabase.rpc("get_task_assignable_profiles")
  return { data: result.data || [], error: result.error }
}

export async function getProfilesTaskUnavailability(profileIds = [], date) {
  const ids = [...new Set((profileIds || []).filter(Boolean))]
  if (!ids.length || !date) return { data: {}, error: null }

  const result = await supabase.rpc("get_profiles_task_unavailability", {
    p_profile_ids: ids,
    p_date: date
  })

  if (result.error) return { data: {}, error: result.error }

  const map = {}
  ;(result.data || []).forEach((row) => {
    if (row?.profile_id && row?.reason) map[row.profile_id] = row.reason
  })
  return { data: map, error: null }
}
