"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageHeader } from "@/components/page-header"
import { GuardedLink as Link, useNavigationGuard } from "@/components/shell/navigation-guard"
import { RequestError } from "@/components/feedback/session-recovery"
import { Button } from "@/components/ui/button"
import { useResource } from "@/hooks/use-operation"
import { erpFetch } from "@/lib/api/client"
import { productImportHref, readProductImport, readProductImportFile } from "./product-import-model"
import { ProductImportJob } from "./product-import-job"

type Access = { tenant?: { id: string } | null; permissions?: string[] }
export const importPath = "/preferencias/dados/importacao"

export function DataImport() {
  return <Suspense fallback={<div role="status" className="p-4">Conferindo acesso…</div>}><ImportWorkspace /></Suspense>
}
function ImportWorkspace() {
  const access = useResource<Access>("/api/erp/me")
  const params = useSearchParams()
  const job = params.get("job") || ""
  const tenant = access.value?.tenant?.id
  let invalidJob = false
  try { if (job) productImportHref(job) } catch { invalidJob = true }
  return <div className="mx-auto max-w-4xl space-y-3 p-4 [--workspace-control-height:44px] sm:[--workspace-control-height:36px]">
    <PageHeader eyebrow="Preferências / Dados" title="Importação de produtos" description="Escolha um CSV, confira a prévia e confirme a importação." />
    {access.loading ? <p role="status">Conferindo acesso…</p> : access.error || !tenant ? <div role="alert" className="space-y-2 text-sm [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"><RequestError message={access.error || "Selecione uma empresa para importar produtos."} status={access.status} /><Button onClick={access.reload} variant="outline">Conferir acesso</Button></div>
      : !access.value?.permissions?.includes("catalog.products.import") ? <div className="space-y-2 text-sm"><p>Seu acesso não permite importar produtos. Solicite a permissão à gestão.</p><Button onClick={access.reload} variant="outline">Conferir acesso</Button></div>
      : invalidJob ? <div role="alert" className="text-sm">O identificador da prévia é inválido. <Link className="inline-flex min-h-11 items-center text-primary underline" href={importPath}>Escolher arquivo</Link></div>
      : job ? <ProductImportJob key={`${tenant}:${job}`} id={job} tenant={tenant} initialPending={params.get("pending") === "1"} canReadCatalog={!!access.value.permissions?.includes("catalog.products.read")} /> : <ImportFileForm key={tenant} tenant={tenant} />}
    <Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href="/preferencias?categoria=importacao">Voltar às preferências</Link>
  </div>
}
function ImportFileForm({ tenant }: { tenant: string }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [status, setStatus] = useState(0)
  const active = useRef<AbortController | null>(null)
  const live = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false; active.current?.abort() } }, [])
  useNavigationGuard(file || busy ? "Sair antes de concluir a prévia deste arquivo?" : null)
  async function generate() {
    if (!file || active.current) return
    const controller = new AbortController()
    active.current = controller; setBusy(true); setError(""); setStatus(0)
    let responseStatus = 0
    let navigating = false
    try {
      const input = await readProductImportFile(file)
      if (controller.signal.aborted) return
      const response = await erpFetch("/api/erp/products/import", { method: "POST", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenant }, body: JSON.stringify(input), signal: controller.signal })
      responseStatus = response.status
      const preview = await readProductImport(response)
      if (!live.current || controller.signal.aborted) return
      navigating = true
      router.replace(productImportHref(preview.id))
    } catch (cause) {
      if (live.current && !controller.signal.aborted) { setStatus(responseStatus); setError(cause instanceof Error ? cause.message : "Não foi possível gerar a prévia. Tente novamente.") }
    } finally { if (live.current && !navigating) { active.current = null; setBusy(false) } }
  }
  return <form className="space-y-3 rounded-lg border bg-card p-3 text-sm" onSubmit={event => { event.preventDefault(); void generate() }}>
    <label className="grid min-w-0 gap-1 font-medium">Arquivo CSV<input type="file" className="min-h-11 w-full min-w-0 rounded-md border p-2 text-sm" accept=".csv,text/csv" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setError(""); setStatus(0) }} /></label>
    <p className="text-xs text-muted-foreground">CSV em UTF-8, até 2 MiB e 5.000 linhas. A prévia não cadastra produtos.</p>
    <details className="rounded-md border px-3"><summary className="flex min-h-11 cursor-pointer items-center font-medium">Formato do arquivo</summary><div className="space-y-2 pb-2 text-xs"><p>Colunas obrigatórias: sku, name, unit e base_price. Preencha a unidade com até 6 letras, como UN, e o preço com ponto e duas casas decimais, como 19419.84, sem separador de milhar.</p><p>Opcionais: ncm, cest e status. NCM e CEST podem ser exigidos pela configuração da empresa. A situação aceita active ou archived; vazia usa active.</p><a href="/modelo-importacao-produtos.csv" download className="inline-flex min-h-11 items-center text-primary underline">Baixar modelo CSV</a></div></details>
    <Button type="submit" disabled={!file || busy}>{busy ? "Gerando prévia…" : "Gerar prévia"}</Button>
    {busy && <p role="status">Lendo arquivo e gerando prévia…</p>}
    {error && <p role="alert" className="text-destructive [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"><RequestError message={error} status={status} /></p>}
  </form>
}
