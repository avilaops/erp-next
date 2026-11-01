"use client"

import { erpFetch } from "@/lib/api/client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { CompanySnapshot } from "./company-types"

type Profile = { company: CompanySnapshot | null; message: string; status: number; reload: () => void }
const CompanyProfileContext = createContext<Profile | null>(null)

export function CompanyProfileProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<CompanySnapshot | null>(null)
  const [message, setMessage] = useState("Carregando empresa ativa…")
  const [status, setStatus] = useState(0)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    erpFetch("/api/erp/company", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const value = await response.json()
        if (controller.signal.aborted) return
        setStatus(response.status)
        if (response.ok) setCompany(value)
        else { setCompany(null); setMessage(value.title || "Não foi possível consultar a empresa") }
      }).catch(() => {
        if (!controller.signal.aborted) { setCompany(null); setStatus(503); setMessage("Não foi possível consultar a empresa") }
      })
    return () => controller.abort()
  }, [retry])

  function reload() {
    setCompany(null); setStatus(0); setMessage("Carregando empresa ativa…"); setRetry(value => value + 1)
  }

  return <CompanyProfileContext.Provider value={{ company, message, status, reload }}>{children}</CompanyProfileContext.Provider>
}

export function useCompanyProfile() {
  const profile = useContext(CompanyProfileContext)
  if (!profile) throw new Error("CompanyProfileProvider required")
  return profile
}
