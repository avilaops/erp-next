"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"

type IssuedNfe = {
  id: string
  status: string
  environment: "homologation" | "production"
  model: number
  series: number
  number: number
  accessKey: string | null
  protocol: string | null
  result: { reason?: string; code?: string }
}

type Page = { tenantId: string; data: IssuedNfe[]; nextCursor: string | null }

const statusLabels: Record<string, string> = {
  authorized: "Autorizada",
  cancelled: "Cancelada",
  rejected: "Rejeitada",
  preparing: "Preparando",
  prepared: "Preparada",
  unknown: "Resultado incerto",
}

export function IssuedNfes() {
  const [page, setPage] = useState<Page | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (nextCursor: string | null = null) => {
    setBusy(true)
    setError("")
    try {
      const [documentsResponse, meResponse] = await Promise.all([
        erpFetch(`/api/erp/fiscal/issued-nfes?limit=25${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, { cache: "no-store" }),
        erpFetch("/api/erp/me", { cache: "no-store" }),
      ])
      const documents = await documentsResponse.json() as Page & { title?: string }
      const me = await meResponse.json() as { tenant?: { id?: string }; title?: string }
      if (!documentsResponse.ok) throw new Error(documents.title || "Não foi possível carregar as emissões")
      if (!meResponse.ok || !me.tenant?.id || me.tenant.id !== documents.tenantId) throw new Error("A empresa da sessão mudou. Atualize a página")
      setPage(previous => nextCursor ? { ...documents, data: [...(previous?.data || []), ...documents.data] } : documents)
      setCursor(documents.nextCursor)
    } catch (reason) {
      setPage(null)
      setCursor(null)
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar as emissões")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="issued-nfes-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="issued-nfes-title" className="text-lg font-semibold">Emissões e tentativas registradas</h2>
        <p className="mt-1 text-sm text-muted-foreground">Documentos persistidos pela empresa ativa. Homologação não possui valor fiscal.</p>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>Atualizar</Button>
    </div>
    {busy && <p role="status" className="text-sm text-muted-foreground">Carregando documentos fiscais…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!busy && !error && page && page.data.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nenhuma emissão ou tentativa registrada nesta empresa.</p>}
    {!busy && !error && page && page.data.length > 0 && <div className="divide-y divide-border rounded-xl border">
      {page.data.map(document => <Link className="block p-4 transition hover:bg-muted/30" href={`/fiscal/notas-saida/${document.id}`} key={document.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <strong className="text-primary">{document.model === 65 ? "NFC-e" : "NF-e"} {document.number} · Série {document.series}</strong>
            <p className="mt-1 text-sm text-muted-foreground">{document.environment === "homologation" ? "Homologação" : "Produção"} · {document.accessKey || "Chave ainda não disponível"}</p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{statusLabels[document.status] || document.status}</span>
        </div>
        {(document.protocol || document.result?.reason) && <p className="mt-2 text-sm text-muted-foreground">{document.protocol ? `Protocolo: ${document.protocol}` : document.result.reason}</p>}
      </Link>)}
    </div>}
    {cursor && <Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Carregar mais</Button>}
  </section>
}
