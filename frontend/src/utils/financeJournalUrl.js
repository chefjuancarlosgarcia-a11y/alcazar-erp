/** @param {URLSearchParams} searchParams */
export function removeEntrySearchParam(searchParams) {
  if (!searchParams?.get?.("entry")) return null
  const next = new URLSearchParams(searchParams)
  next.delete("entry")
  return next
}
