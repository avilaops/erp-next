export const partySessionEnded = "erp:party-session-ended"
const prefix = "erp:party-draft:"

/** Keep only the current authenticated scope; no scope ends the draft session. */
export function clearPartyDrafts(keepScope?: string): boolean {
  try {
    const keepPrefix = keepScope ? `${prefix}v1:${keepScope}:` : null
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith(prefix) && (!keepPrefix || !key.startsWith(keepPrefix)))
    for (const key of keys) sessionStorage.removeItem(key)
    return true
  } catch { return false }
}

export function endPartyDraftSession() {
  // Stop mounted editors before removing storage so their effects cannot refill it.
  window.dispatchEvent(new Event(partySessionEnded))
  return clearPartyDrafts()
}
