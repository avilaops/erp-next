"use client"
import { useLayoutEffect } from "react"
import { clearPartyDrafts } from "@/lib/party-draft-session"

export function PartyDraftSessionCleanup({ scope }: { scope?: string }) {
  useLayoutEffect(() => { clearPartyDrafts(scope) }, [scope])
  return null
}
