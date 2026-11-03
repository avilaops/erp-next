"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import { cteCodeLabel, readCtePage, readCteRun, readCteXml, type CteDocument, type CtePage } from "./cte-documents"
import { saveDocument } from "./received-documents"
import { readCteInspection } from "./cte-inspections"
import { CteInspectionPanel } from "./cte-inspection-panel"
import { CteLinksPanel } from "./cte-links-panel"
import { parseCteAccess, type CteAccess, type CteInspectionView } from "./cte-inspection-model"

const kinds = { full: "CT-e completo", event: "Evento CT-e", unrecognized: "Arquivo não interpretado" }

export function CteDistributionScreen() {
  const [view, setView] = useState<CtePage | null>(null)
  const [company, setCompany] = useState("")
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<CteDocument | null>(null)
  const [inspection, setInspection] = useState<CteInspectionView | null>(null)
  const operation = useRef<AbortController | null>(null)
  const accessContext = useRef<CteAccess | null>(null)
  const command = useRef<{ tenantId: string; documentId: string; hash: string; key: string } | null>(null)
  const commercialBusy = useCallback((value: boolean) => setBusy(value ? "commercial" : ""), [])

  const readCompany = useCallback(async (expected: string | null, signal: AbortSignal) => {
    const response = await erpFetch("/api/erp/me", { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
    const access: unknown = await response.json().catch(() => null)
    signal.throwIfAborted()
    let current: CteAccess
    try {
      if (!response.ok) throw new Error("Entre e selecione uma empresa antes de consultar CT-e")
      current = parseCteAccess(access, expected && accessContext.current ? { id: expected, subject: accessContext.current.subject, permissions: accessContext.current.permissions } : undefined)
      if (expected && !accessContext.current) throw new Error("A sessão precisa ser atualizada antes de continuar")
    } catch (reason) {
      command.current = null; accessContext.current = null
      setView(null); setCompany(""); setSelected(null); setInspection(null)
      throw reason
    }
    if (accessContext.current && (accessContext.current.id !== current.id || accessContext.current.subject !== current.subject) || command.current && command.current.tenantId !== current.id) {
      command.current = null
      setView(null); setCompany(""); setSelected(null); setInspection(null)
    }
    accessContext.current = current
    return current
  }, [])

  const verifyCommercialAccess = useCallback(async (signal: AbortSignal) => {
    if (!view) throw new Error("Atualize os arquivos antes de consultar vínculos")
    try { return await readCompany(view.snapshot.tenantId, signal) }
    catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : "Não foi possível confirmar o acesso aos vínculos"); throw error }
  }, [readCompany, view])

  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const current = await readCompany(null, controller.signal)
      const page = await readCtePage(current.id, offset, controller.signal)
      const confirmed = await readCompany(current.id, controller.signal)
      if (!controller.signal.aborted) { setView(page); setCompany(confirmed.legalName); setError("") }
    }
    void load().catch(reason => { if (!controller.signal.aborted) { setView(null); setCompany(""); setSelected(null); setInspection(null); setError(reason instanceof Error ? reason.message : "Não foi possível consultar os arquivos CT-e") } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [offset, refresh, readCompany])

  function reload(nextOffset = offset) {
    if (loading || operation.current) return
    setView(null); setCompany(""); setSelected(null); setInspection(null); setError(""); setNotice(""); setLoading(true)
    setOffset(nextOffset); setRefresh(value => value + 1)
  }

  async function inspect(document: CteDocument, action: "xml" | "run" | "inspection" | "check") {
    if (!view || loading || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(`${document.id}-${action}`); setError(""); setNotice("")
    try {
      const tenantId = view.snapshot.tenantId
      await readCompany(tenantId, controller.signal)
      if (action === "xml") {
        const bytes = await readCteXml(document, tenantId, controller.signal)
        await readCompany(tenantId, controller.signal)
        controller.signal.throwIfAborted()
        saveDocument(bytes, "application/xml", `CTE-${document.nsu}.xml`)
        setNotice(`XML original do NSU ${document.nsu} preparado para download. Situação fiscal externa pendente.`)
      } else if (action === "run") {
        const result = await readCteRun(document, tenantId, controller.signal)
        await readCompany(tenantId, controller.signal)
        if (!controller.signal.aborted) setNotice(result)
      } else {
        let key: string | undefined
        if (action === "check") {
          if (!command.current || command.current.tenantId !== tenantId || command.current.documentId !== document.id || command.current.hash !== document.xmlSha256) command.current = { tenantId, documentId: document.id, hash: document.xmlSha256, key: crypto.randomUUID() }
          key = command.current.key
        }
        const result = await readCteInspection(document, tenantId, controller.signal, key)
        await readCompany(tenantId, controller.signal)
        if (!controller.signal.aborted) {
          setSelected(document); setInspection(result)
          if (action === "check") setNotice("Conferência local registrada. O XML e o cursor foram preservados.")
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setView(null); setCompany(""); setSelected(null); setInspection(null)
        setError(reason instanceof Error ? reason.message : "Não foi possível consultar o arquivo CT-e")
      }
    } finally { operation.current = null; if (!controller.signal.aborted) setBusy("") }
  }

  return <div className="mx-auto max-w-6xl space-y-6 px-4 pb-24 pt-8 lg:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div className="min-w-0"><p className="text-sm text-primary">Fiscal / CT-e</p><h1 className="mt-2 text-3xl font-semibold">CT-e recebidos</h1><p className="mt-2 break-words text-muted-foreground">{company || "Documentos da empresa ativa"}</p></div>
      <Link className={buttonVariants({ variant: "outline" })} href="/fiscal">Abrir central fiscal</Link>
    </header>
    <section className="form-section space-y-3" aria-labelledby="cte-environment">
      <h2 id="cte-environment" className="text-lg font-semibold">Homologação — sem valor fiscal</h2>
      <p className="text-sm text-muted-foreground">Consulte os arquivos já coletados para esta empresa. Atualizar esta tela não consulta a SEFAZ. A captura em produção ainda não está disponível.</p>
      <p className="text-sm">Abra a conferência local para ver transportadora, tomador, valores e referências do arquivo. Confiança do certificado e situação fiscal atual não são comprovadas aqui. Estes arquivos não geram compras, vendas, estoque ou lançamentos financeiros.</p>
    </section>
    <section className="form-section min-w-0 space-y-4" aria-labelledby="cte-files">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="cte-files" className="text-lg font-semibold">Arquivos armazenados{view ? ` (${view.total})` : ""}</h2><Button variant="outline" disabled={loading || !!busy} onClick={() => reload()}>Atualizar arquivos</Button></div>
      {loading && <p role="status" className="text-sm">Carregando arquivos CT-e…</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="break-words text-sm">{notice}</p>}
      {view && <>
        <p className="text-sm text-muted-foreground">{view.snapshot.running ? "Uma captura está em andamento." : view.snapshot.lastCode ? `Última captura: ${cteCodeLabel(view.snapshot.lastCode)}.` : "Nenhuma captura concluída."}</p>
        {!view.data.length && <p className="text-sm">{view.total ? "Nenhum arquivo nesta página. Volte aos arquivos anteriores." : "Nenhum arquivo CT-e coletado em homologação."}</p>}
        {view.data.map(document => <article key={document.id} aria-label={`NSU ${document.nsu}`} className="min-w-0 space-y-3 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{kinds[document.kind]}</h3><p className="break-all text-muted-foreground">NSU {document.nsu}</p></div><span className="rounded-md bg-muted px-2 py-1 text-xs">Situação fiscal externa pendente</span></div>
          <dl className="grid gap-3 sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted-foreground">CNPJ da coleta</dt><dd className="break-all">{document.companyTaxId}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Formato recebido</dt><dd className="break-all">{document.schema}</dd></div><div><dt className="text-muted-foreground">Coletado em</dt><dd>{new Date(document.createdAt).toLocaleString("pt-BR")}</dd></div></dl>
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy || loading} onClick={() => void inspect(document, "xml")}>{busy === `${document.id}-xml` ? "Preparando XML…" : "Baixar XML original"}</Button><Button variant="outline" disabled={!!busy || loading} onClick={() => void inspect(document, "run")}>{busy === `${document.id}-run` ? "Consultando captura…" : "Consultar captura"}</Button>{document.kind === "full" && document.schema === "procCTe_v4.00.xsd" && <Button variant="outline" disabled={!!busy || loading} onClick={() => void inspect(document, "inspection")}>{busy === `${document.id}-inspection` ? "Lendo conferência…" : "Ver conferência"}</Button>}</div>
          {selected?.id === document.id && inspection && <CteInspectionPanel view={inspection} busy={!!busy || loading} checking={busy === `${document.id}-check`} onInspect={() => void inspect(document, "check")} />}
          {selected?.id === document.id && inspection?.data && <CteLinksPanel inspected={inspection} verifyAccess={verifyCommercialAccess} disabled={loading || !!busy && busy !== "commercial"} onBusy={commercialBusy} />}
        </article>)}
        {(view.total > 25 || offset > 0) && <nav aria-label="Páginas de arquivos CT-e" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={loading || !!busy || !offset} onClick={() => reload(Math.max(0, offset - 25))}>Arquivos anteriores</Button><span className="text-sm">{view.data.length ? `${offset + 1}–${offset + view.data.length} de ${view.total}` : `0 de ${view.total}`}</span><Button variant="outline" disabled={loading || !!busy || offset + 25 >= view.total} onClick={() => reload(offset + 25)}>Próximos arquivos</Button></nav>}
      </>}
    </section>
  </div>
}
