"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"
import { TemplateCanvas } from "./template-canvas"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { RequestError } from "@/components/session-recovery"
import { useCommand, useResource } from "@/features/operations/use-operation"

type Area = { page: number; x: number; y: number; width: number; height: number }
type Field = Area & { id: string; name: string; kind: string; role: string; required: boolean; fontSize?: number; additionalAreas?: Area[] }
type Definition = { name: string; pages: number; roles: string[]; fields: Field[] }
type Detail = { tenantId: string; canEdit: boolean; id: string; definition: Definition; revision: number; versions?: { revision: number; status: string; externalId: number | null }[] }
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
    {!id && listing.value && <ConnectedModels tenant={listing.value.tenantId} />}
  </>
}

type Catalog = { configured: boolean; canEdit: boolean; data: { id: number; name: string; canImport: boolean; draftId: string | null }[] }
function ConnectedModels({ tenant }: { tenant: string }) {
  const resource = useResource<Catalog>("/api/erp/contract-template-drafts/catalog")
  const command = useCommand()
  const router = useRouter()
  const [selection, setSelection] = useState<{ id: string; templateId: number } | null>(null)
  async function importModel(templateId: number) {
    const target = command.uncertain && selection ? selection : { id: crypto.randomUUID(), templateId }
    setSelection(target)
    const saved = await command.send<{ id: string }>(`/api/erp/contract-template-drafts/${target.id}/import`, tenant, { templateId: target.templateId }, "")
    if (saved) router.push(`/servicos/contratos/modelos/${saved.id}`)
  }
  return <section className="form-section mt-5 space-y-4">
    <h2 className="text-lg font-semibold">Modelos do serviço conectado</h2>
    <p>Os modelos autorizados para esta empresa aparecem aqui. Abrir no editor cria uma cópia privada; o original e os contratos existentes são preservados.</p>
    {resource.loading ? <p role="status">Consultando serviço…</p> : resource.error ? <RequestError message={resource.error} status={resource.status} /> : !resource.value?.configured ? <p>O serviço de contratos ainda não está conectado.</p> : !resource.value.data.length ? <p>Nenhum modelo associado à empresa.</p> : <ul className="space-y-4">{resource.value.data.map(model => <li key={model.id} className="space-y-2">
      <p>{model.name}</p>
      {model.draftId ? <Link className={linkClass} href={`/servicos/contratos/modelos/${model.draftId}`}>Abrir cópia no editor</Link> : <>
        <Button type="button" variant="outline" disabled={!resource.value?.canEdit || !model.canImport || command.busy || (command.uncertain && selection?.templateId !== model.id)} onClick={() => void importModel(model.id)}>{command.uncertain && selection?.templateId === model.id ? "Conferir importação" : "Editar cópia no ERP"}</Button>
        {!model.canImport && <p className="text-sm">Este modelo contém recursos ainda não suportados pelo editor. Continue usando o original nos pedidos.</p>}
      </>}
    </li>)}</ul>}
    {command.error && <RequestError message={command.error} status={command.status} />}
  </section>
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
  const publication = useCommand()
  const [definition, setDefinition] = useState<Definition>(initial?.definition || { name: "", pages: 1, roles: ["Cliente"], fields: [] })
  const [pdf, setPdf] = useState<string | null>(null)
  const [fileError, setFileError] = useState("")
  const [loadingFile, setLoadingFile] = useState(false)
  const [revision, setRevision] = useState(initial?.revision)
  const [savedDefinition, setSavedDefinition] = useState(initial ? JSON.stringify(initial.definition) : "")
  const [publishedRevision, setPublishedRevision] = useState(initial?.versions?.find(version => version.status === "published")?.revision)
  const [notice, setNotice] = useState("")
  const [pdfReady, setPdfReady] = useState(false)
  const readPages = useCallback((pages: number) => { setDefinition(value => ({ ...value, pages })); setPdfReady(true) }, [])
  const blocked = !canEdit || command.busy || command.uncertain || command.stale || loadingFile || publication.busy || publication.uncertain || publication.stale
  const dirty = !!pdf || JSON.stringify(definition) !== savedDefinition
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
      setPdfReady(false)
    } catch (error) { setFileError(error instanceof Error ? error.message : "Arquivo indisponível.") }
    finally { setLoadingFile(false) }
  }
  async function save() {
    setNotice("")
    const saved = await command.send<Detail>(`/api/erp/contract-template-drafts/${id}`, tenant, { definition, pdfBase64: pdf?.split(",")[1] || null }, revision ? `"${revision}"` : "")
    if (saved) {
      setRevision(saved.revision); setSavedDefinition(JSON.stringify(saved.definition)); setPdf(null); setNotice("Rascunho salvo. Ainda não publicado para os pedidos.")
      if (!initial) router.replace(`/servicos/contratos/modelos/${saved.id}`)
    }
  }
  async function publish() {
    if (!revision) return
    setNotice("")
    const result = await publication.send<{ revision: number }>(`/api/erp/contract-template-drafts/${id}/publish`, tenant, {}, `"${revision}"`)
    if (result) { setPublishedRevision(result.revision); setNotice(`Revisão ${result.revision} publicada e disponível nos pedidos.`) }
  }
  const positioned = definition.fields.flatMap(field => [field, ...(field.additionalAreas || [])].map((area, index) => ({ ...area, name: field.name, id: `${field.id}:${index}` })))
  function moveArea(key: string, position: { x: number; y: number }) {
    const [fieldId, rawIndex] = key.split(":")
    const index = Number(rawIndex)
    const field = definition.fields.find(field => field.id === fieldId)
    if (!field) return
    changeField(fieldId, index === 0 ? position : { additionalAreas: field.additionalAreas?.map((area, i) => i === index - 1 ? { ...area, ...position } : area) })
  }
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); void save() }}>
    <p className="rounded-xl border p-3">Salvar preserva o rascunho. Publicar cria uma versão para os pedidos; contratos já gerados continuam com seus documentos originais.</p>
    {!canEdit && <p role="status">Sua sessão permite consultar. A edição exige permissão de gestão de integrações.</p>}
    <fieldset disabled={blocked} className="form-section space-y-4">
      <label className="block">Nome do modelo<Input required maxLength={200} value={definition.name} onChange={e => setDefinition({ ...definition, name: e.target.value })} /></label>
      <label className="block">PDF do modelo<Input type="file" accept="application/pdf,.pdf" required={!revision && !pdf} onChange={e => void loadFile(e.target.files?.[0])} /></label>
      <p>Número de páginas: {definition.pages} · identificado ao abrir o PDF.</p>
      <label className="block">Participantes, separados por ponto e vírgula<Input required value={definition.roles.join(";")} onChange={e => setDefinition({ ...definition, roles: e.target.value.split(";") })} /></label>
      <p className="text-sm">Use nomes como Cliente;Empresa;Testemunha.</p>
    </fieldset>
    {(pdf || revision) && <section className="form-section space-y-3"><h2 className="text-lg font-semibold">Documento e posição dos campos</h2><TemplateCanvas key={pdf || id} source={pdf || `/api/erp/contract-template-drafts/${id}/pdf`} fields={positioned} disabled={blocked} onPages={readPages} onMove={moveArea} /></section>}
    <fieldset disabled={blocked} className="form-section space-y-4">
      <h2 className="text-lg font-semibold">Campos e assinaturas</h2>
      <p>Adicione um campo e posicione-o sobre o PDF. Para ajustes precisos, use os percentuais abaixo, medidos a partir do canto superior esquerdo da página.</p>
      {definition.fields.map((field, index) => <fieldset key={field.id} className="space-y-3 rounded-xl border p-4">
        <legend>Campo {index + 1}</legend>
        <label className="block">Nome do campo<Input required maxLength={200} value={field.name} onChange={e => changeField(field.id, { name: e.target.value })} /></label>
        <label className="block">Dado do ERP<select aria-label="Dado do ERP" className={selectClass} value={Object.hasOwn(sources, field.name) ? field.name : ""} onChange={e => { if (e.target.value) changeField(field.id, { name: e.target.value }) }}><option value="">Preenchimento manual / assinatura</option>{Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">Tipo<select className={selectClass} value={field.kind} onChange={e => changeField(field.id, { kind: e.target.value })}>{[["text", "Texto"], ["signature", "Assinatura"], ["initials", "Rubrica"], ["date", "Data"], ["number", "Número"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block">Participante<select className={selectClass} value={field.role} onChange={e => changeField(field.id, { role: e.target.value })}>{!definition.roles.includes(field.role) && <option value={field.role}>Participante removido: {field.role}</option>}{definition.roles.map((role, i) => <option key={i} value={role}>{role || "Sem nome"}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-5">{([["page", "Página"], ["x", "Horizontal (%)"], ["y", "Vertical (%)"], ["width", "Largura (%)"], ["height", "Altura (%)"]] as const).map(([key, label]) => <label key={key}>{label}<Input type="number" required step={key === "page" ? 1 : 0.1} min={key === "page" ? 1 : key === "width" || key === "height" ? 0.1 : 0} max={key === "page" ? definition.pages : 100} value={field[key]} onChange={e => changeField(field.id, { [key]: Number(e.target.value) })} /></label>)}</div>
        <label className="flex gap-2"><input type="checkbox" checked={field.required} onChange={e => changeField(field.id, { required: e.target.checked })} />Obrigatório</label>
        {(field.additionalAreas || []).map((area, areaIndex) => <fieldset key={areaIndex} className="space-y-2 rounded-lg border p-3">
          <legend>Posição adicional {areaIndex + 1} de {field.name}</legend>
          <div className="grid gap-3 sm:grid-cols-5">{([["page", "Página"], ["x", "Horizontal (%)"], ["y", "Vertical (%)"], ["width", "Largura (%)"], ["height", "Altura (%)"]] as const).map(([key, label]) => <label key={key}>{label}<Input type="number" required step={key === "page" ? 1 : 0.1} min={key === "page" ? 1 : key === "width" || key === "height" ? 0.1 : 0} max={key === "page" ? definition.pages : 100} value={area[key]} onChange={e => changeField(field.id, { additionalAreas: field.additionalAreas?.map((current, i) => i === areaIndex ? { ...current, [key]: Number(e.target.value) } : current) })} /></label>)}</div>
          <Button type="button" variant="outline" onClick={() => changeField(field.id, { additionalAreas: field.additionalAreas?.filter((_, i) => i !== areaIndex) })}>Remover posição adicional {areaIndex + 1}</Button>
        </fieldset>)}
        <Button type="button" variant="outline" disabled={(field.additionalAreas?.length || 0) >= 99} onClick={() => changeField(field.id, { additionalAreas: [...(field.additionalAreas || []), { page: Math.min(definition.pages, field.page + 1), x: field.x, y: field.y, width: field.width, height: field.height }] })}>Repetir campo em outra posição</Button>
        {field.kind !== "signature" && field.kind !== "initials" && <label className="block">Tamanho da fonte (pt)<Input type="number" min={6} max={72} step={0.5} value={field.fontSize ?? 12} onChange={e => changeField(field.id, { fontSize: Number(e.target.value) })} /></label>}
        <Button type="button" variant="outline" onClick={() => setDefinition(value => ({ ...value, fields: value.fields.filter(item => item.id !== field.id) }))}>Remover campo {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="outline" disabled={definition.fields.length >= 100} onClick={() => setDefinition(value => ({ ...value, fields: [...value.fields, { id: crypto.randomUUID(), name: `campo_${value.fields.length + 1}`, kind: "text", role: value.roles[0], required: true, page: 1, x: 5, y: 5, width: 40, height: 5 }] }))}>Adicionar campo</Button>
    </fieldset>
    {fileError && <p role="alert">{fileError}</p>}
    {command.error && <RequestError message={command.error} status={command.status} />}
    {notice && <p role="status">{notice}</p>}
    <Button type="submit" disabled={!canEdit || command.busy || command.stale || loadingFile || !!fileError || !pdfReady || publication.busy || publication.uncertain || publication.stale}>{command.busy ? "Salvando…" : command.uncertain ? "Conferir salvamento" : "Salvar rascunho"}</Button>
    <section className="form-section space-y-3">
      <h2 className="text-lg font-semibold">Publicação para os pedidos</h2>
      <p>Cada participante precisa ter uma assinatura obrigatória. A publicação preserva uma versão do PDF e dos campos; não envia convites.</p>
      {dirty && <p>Salve as alterações antes de publicar.</p>}
      {publishedRevision && <p>Última revisão publicada: {publishedRevision}.</p>}
      <Button type="button" disabled={!canEdit || !revision || dirty || !pdfReady || command.busy || command.uncertain || command.stale || publication.busy || publication.stale || publishedRevision === revision} onClick={() => void publish()}>{publication.busy ? "Confirmando publicação…" : publication.uncertain || initial?.versions?.some(version => version.revision === revision && version.status === "pending") ? "Conferir publicação" : "Publicar versão para os pedidos"}</Button>
      {publication.error && <RequestError message={publication.error} status={publication.status} />}
    </section>
  </form>
}
