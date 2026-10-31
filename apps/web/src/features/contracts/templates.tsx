"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/session-recovery"
import { useCommand, useResource } from "@/features/operations/use-operation"

type Field = { id: string; name: string; kind: string; role: string; required: boolean; page: number; x: number; y: number; width: number; height: number }
type Definition = { name: string; pages: number; roles: string[]; fields: Field[] }
type Detail = { tenantId: string; canEdit: boolean; id: string; definition: Definition; revision: number }
type Listing = { tenantId: string; canEdit: boolean; data: { id: string; name: string; revision: number }[] }
const linkClass = "text-primary underline underline-offset-4"
const selectClass = "block min-h-10 w-full rounded-lg border bg-background p-2"
const sources = { empresa_nome: "Nome da empresa", empresa_documento: "Documento da empresa", empresa_endereco: "Endereço da empresa", cliente_nome: "Nome do cliente", cliente_documento: "Documento do cliente", cliente_endereco: "Endereço do cliente", cliente_email: "E-mail do cliente", pedido_numero: "Número do pedido", pedido_total: "Total do pedido", itens: "Itens e valores", vencimento: "Vencimento", condicoes: "Condições comerciais", entrega: "Entrega" }

export function Templates({ id }: { id?: string }) {
  const listing = useResource<Listing>("/api/erp/contract-template-drafts")
  return <>
    <PageHeader eyebrow="Ávila Ops · Contratos" title={id ? "Editor de modelo" : "Modelos de contrato"} description="Prepare o PDF, os participantes e os campos do modelo da empresa." />
    <p className="mb-4"><Link className={linkClass} href={id ? "/servicos/contratos/modelos" : "/servicos/contratos"}>Voltar aos {id ? "modelos" : "contratos"}</Link></p>
    {listing.loading ? <p role="status">Carregando modelos…</p> : listing.error || !listing.value ? <RequestError message={listing.error} status={listing.status} /> : id === "novo" ?
      <Editor tenant={listing.value.tenantId} canEdit={listing.value.canEdit} /> : id ? <Existing id={id} /> : <section className="form-section space-y-4">
        {listing.value.canEdit && <Link className={linkClass} href="/servicos/contratos/modelos/novo">Novo modelo</Link>}
        <p>Rascunhos em preparação. A publicação para uso nos pedidos é uma etapa separada.</p>
        {!listing.value.data.length ? <p>Nenhum rascunho cadastrado.</p> : <ul className="space-y-3">{listing.value.data.map(model => <li key={model.id}><Link className={linkClass} href={`/servicos/contratos/modelos/${model.id}`}>{model.name}</Link> · Rascunho · Revisão {model.revision}</li>)}</ul>}
      </section>}
  </>
}

function Existing({ id }: { id: string }) {
  const result = useResource<Detail>(`/api/erp/contract-template-drafts/${id}`)
  if (result.loading) return <p role="status">Carregando rascunho…</p>
  if (!result.value || result.error) return <RequestError message={result.error} status={result.status} />
  return <Editor key={`${id}:${result.etag}`} tenant={result.value.tenantId} canEdit={result.value.canEdit} initial={result.value} />
}

function Editor({ tenant, canEdit, initial }: { tenant: string; canEdit: boolean; initial?: Detail }) {
  const router = useRouter()
  const command = useCommand()
  const [id] = useState(() => initial?.id || crypto.randomUUID())
  const [definition, setDefinition] = useState<Definition>(initial?.definition || { name: "", pages: 1, roles: ["Cliente"], fields: [] })
  const [pdf, setPdf] = useState<string | null>(null)
  const [fileError, setFileError] = useState("")
  const [loadingFile, setLoadingFile] = useState(false)
  const [revision, setRevision] = useState(initial?.revision)
  const [notice, setNotice] = useState("")
  const blocked = !canEdit || command.busy || command.uncertain || command.stale || loadingFile
  const changeField = (id: string, change: Partial<Field>) => setDefinition(value => ({ ...value, fields: value.fields.map(field => field.id === id ? { ...field, ...change } : field) }))
  async function loadFile(file?: File) {
    setFileError("")
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setFileError("Envie um PDF de até 5 MiB."); return }
    setLoadingFile(true)
    try {
      if (new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("O arquivo não é um PDF.")
      const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler o arquivo.")); reader.readAsDataURL(file) })
      setPdf(value)
    } catch (error) { setFileError(error instanceof Error ? error.message : "Arquivo indisponível.") }
    finally { setLoadingFile(false) }
  }
  async function save() {
    setNotice("")
    const saved = await command.send<Detail>(`/api/erp/contract-template-drafts/${id}`, tenant, { definition, pdfBase64: pdf?.split(",")[1] || null }, revision ? `"${revision}"` : "")
    if (saved) {
      setRevision(saved.revision); setPdf(null); setNotice("Rascunho salvo. Ainda não publicado para os pedidos.")
      if (!initial) router.replace(`/servicos/contratos/modelos/${saved.id}`)
    }
  }
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); void save() }}>
    <p className="rounded-xl border p-3">Editor próprio Ávila Ops · Rascunho. Salvar preserva este modelo no ERP; não envia convites nem altera contratos já gerados.</p>
    {!canEdit && <p role="status">Sua sessão permite consultar. A edição exige permissão de gestão de integrações.</p>}
    <fieldset disabled={blocked} className="form-section space-y-4">
      <label className="block">Nome do modelo<Input required maxLength={200} value={definition.name} onChange={e => setDefinition({ ...definition, name: e.target.value })} /></label>
      <label className="block">PDF do modelo<Input type="file" accept="application/pdf,.pdf" required={!revision && !pdf} onChange={e => void loadFile(e.target.files?.[0])} /></label>
      <label className="block">Número de páginas do PDF<Input type="number" min={1} max={100} required value={definition.pages} onChange={e => setDefinition({ ...definition, pages: Number(e.target.value) })} /></label>
      <label className="block">Participantes, separados por ponto e vírgula<Input required value={definition.roles.join(";")} onChange={e => setDefinition({ ...definition, roles: e.target.value.split(";") })} /></label>
      <p className="text-sm">Use nomes como Cliente;Empresa;Testemunha. Confira a quantidade de páginas no documento.</p>
    </fieldset>
    {(pdf || revision) && <section className="form-section space-y-3"><h2 className="text-lg font-semibold">Documento de referência</h2><iframe title="PDF do modelo" className="h-[600px] w-full rounded-lg border" src={pdf || `/api/erp/contract-template-drafts/${id}/pdf`} /></section>}
    <fieldset disabled={blocked} className="form-section space-y-4">
      <h2 className="text-lg font-semibold">Campos e assinaturas</h2>
      <p>As posições são percentuais da página, medidos a partir do canto superior esquerdo. O PDF serve como referência; esta tela ainda não desenha os campos sobre ele.</p>
      {definition.fields.map((field, index) => <fieldset key={field.id} className="space-y-3 rounded-xl border p-4">
        <legend>Campo {index + 1}</legend>
        <label className="block">Nome do campo<Input required maxLength={200} value={field.name} onChange={e => changeField(field.id, { name: e.target.value })} /></label>
        <label className="block">Dado do ERP<select aria-label="Dado do ERP" className={selectClass} value={Object.hasOwn(sources, field.name) ? field.name : ""} onChange={e => { if (e.target.value) changeField(field.id, { name: e.target.value }) }}><option value="">Preenchimento manual / assinatura</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">Tipo<select className={selectClass} value={field.kind} onChange={e => changeField(field.id, { kind: e.target.value })}>{[["text", "Texto"], ["signature", "Assinatura"], ["initials", "Rubrica"], ["date", "Data"], ["number", "Número"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">Participante<select className={selectClass} value={field.role} onChange={e => changeField(field.id, { role: e.target.value })}>{!definition.roles.includes(field.role) && <option value={field.role}>Participante removido: {field.role}</option>}{definition.roles.map((role, i) => <option key={i} value={role}>{role || "Sem nome"}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-5">{([["page", "Página"], ["x", "Horizontal (%)"], ["y", "Vertical (%)"], ["width", "Largura (%)"], ["height", "Altura (%)"]] as const).map(([key, label]) => <label key={key}>{label}<Input type="number" required step={key === "page" ? 1 : 0.1} min={key === "page" ? 1 : key === "width" || key === "height" ? 0.1 : 0} max={key === "page" ? definition.pages : 100} value={field[key]} onChange={e => changeField(field.id, { [key]: Number(e.target.value) })} /></label>)}</div>
        <label className="flex gap-2"><input type="checkbox" checked={field.required} onChange={e => changeField(field.id, { required: e.target.checked })} />Obrigatório</label>
        <Button type="button" variant="outline" onClick={() => setDefinition(value => ({ ...value, fields: value.fields.filter(item => item.id !== field.id) }))}>Remover campo {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="outline" disabled={definition.fields.length >= 100} onClick={() => setDefinition(value => ({ ...value, fields: [...value.fields, { id: crypto.randomUUID(), name: `campo_${value.fields.length + 1}`, kind: "text", role: value.roles[0], required: true, page: 1, x: 5, y: 5, width: 40, height: 5 }] }))}>Adicionar campo</Button>
    </fieldset>
    {fileError && <p role="alert">{fileError}</p>}
    {command.error && <RequestError message={command.error} status={command.status} />}
    {notice && <p role="status">{notice}</p>}
    <Button type="submit" disabled={!canEdit || command.busy || command.stale || loadingFile || !!fileError}>{command.busy ? "Salvando…" : command.uncertain ? "Conferir salvamento" : "Salvar rascunho"}</Button>
  </form>
}
