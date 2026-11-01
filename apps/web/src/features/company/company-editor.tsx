"use client"

import { erpFetch } from "@/lib/api/client"

import { AccessLink } from "@/components/session-recovery"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { CompanyDataForm } from "./company-data-form"
import type { CompanyData, CompanyProblem, CompanySnapshot } from "./company-types"

export function CompanyEditor() {
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null)
  const [etag, setEtag] = useState("")
  const [status, setStatus] = useState("loading")
  const [problem, setProblem] = useState<CompanyProblem | null>(null)
  const [conflict, setConflict] = useState(false)

  const receive = useCallback(({ response, result }: { response: Response; result: CompanySnapshot & CompanyProblem }) => {
    if (!response.ok) { setProblem(result); setStatus(response.status === 401 ? "unauthorized" : "error"); return }
    if (!response.headers.get("etag")) throw new Error("missing revision")
    setSnapshot(result)
    setEtag(response.headers.get("etag")!)
    setConflict(false)
    setStatus("ready")
  }, [])

  const failed = useCallback(() => { setProblem({ title: "Não foi possível carregar a empresa" }); setStatus("error") }, [])

  useEffect(() => {
    const controller = new AbortController()
    erpFetch("/api/erp/company", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, result: await response.json() }))
      .then((result) => { if (!controller.signal.aborted) receive(result) })
      .catch(() => { if (!controller.signal.aborted) failed() })
    return () => controller.abort()
  }, [receive, failed])

  function reload() {
    setSnapshot(null)
    setProblem(null)
    setStatus("loading")
    erpFetch("/api/erp/company", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() }))
      .then(receive).catch(failed)
  }

  async function save(data: CompanyData) {
    if (!snapshot || conflict) return false
    setStatus("saving")
    setProblem(null)
    try {
      const response = await erpFetch("/api/erp/company", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": etag, "X-Tenant-Id": snapshot.tenantId }, body: JSON.stringify(data) })
      const result = await response.json()
      if (!response.ok) {
        setProblem(result)
        setConflict(response.status === 412 || response.status === 409)
        setStatus("ready")
        return false
      }
      const nextEtag = response.headers.get("etag")
      if (!nextEtag || result.tenantId !== snapshot.tenantId) {
        setProblem({ title: "Gravação recebida sem confirmação da empresa ou revisão. Sua edição foi preservada; recarregue para conferir." })
        setConflict(true)
        setStatus("ready")
        return false
      }
      setSnapshot(result)
      setEtag(nextEtag)
      setStatus("saved")
      return true
    } catch {
      setProblem({ title: "Não foi possível confirmar a gravação. Sua edição foi preservada; recarregue para conferir a revisão antes de tentar novamente" })
      setConflict(true)
      setStatus("ready")
      return false
    }
  }

  if (!snapshot) return <section className="form-section space-y-4" aria-live="polite">
    {status === "loading" ? <p role="status">Carregando dados da empresa…</p> : <>
      <p role="alert">{problem?.title || "Empresa indisponível"}</p>
      {status === "unauthorized" ? <AccessLink className="font-medium text-primary underline" >Entrar com Ávila Ops</AccessLink> : <Button onClick={reload}>Tentar novamente</Button>}
    </>}
  </section>

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Empresa: {snapshot.data.tradeName || snapshot.data.legalName} · Revisão {snapshot.revision}</p>
      <form action="/api/auth/logout" method="post"><Button type="submit" variant="outline">Sair desta sessão</Button></form>
    </div>
    {!snapshot.canEdit && <p role="status">Você tem acesso de consulta. Solicite permissão para alterar o cadastro.</p>}
    {status === "saved" && <p role="status" className="rounded-xl border border-primary/30 p-4">Cadastro salvo no servidor.</p>}
    {problem && <div role="alert" className="space-y-2 rounded-xl border border-destructive p-4">
      <p>{problem.title || "Não foi possível salvar"}</p>
      {problem.errors?.length ? <ul>{problem.errors.map((error, index) => <li key={`${error.field}-${index}`}>{error.field}: {error.message}</li>)}</ul> : null}
      {conflict && <Button variant="outline" onClick={() => { if (window.confirm("Recarregar os dados do servidor e descartar sua edição atual?")) reload() }}>Recarregar e descartar edição</Button>}
    </div>}
    <CompanyDataForm key={`${snapshot.tenantId}-${snapshot.revision}`} initial={snapshot.data} canEdit={snapshot.canEdit} saving={status === "saving"} conflict={conflict} onSave={save} />
  </div>
}
