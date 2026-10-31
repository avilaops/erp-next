"use client"

import { RequestError } from "@/components/session-recovery"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/features/operations/use-operation"
import { accountTypes, modalities, referenceConfigs, type ReferenceKind, type ReferenceFields, type ReferenceList, type ReferenceSnapshot } from "./reference-config"

const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"

export function ReferenceWorkspace({ kind, id, mode }: { kind: ReferenceKind; id?: string; mode: "list" | "view" | "edit" | "create" }) {
  return mode === "list" ? <List kind={kind} /> : <RecordAccess kind={kind} id={id} mode={mode} />
}

function List({ kind }: { kind: ReferenceKind }) {
  const config = referenceConfigs[kind]
  const [query, setQuery] = useState({ q: "", status: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "25" })
  if (query.status) params.set("status", query.status)
  const result = useResource<ReferenceList>(`/api/erp/${config.endpoint}?${params}`)
  return <><PageHeader eyebrow="Cadastros" title={config.title} description={config.description} /><section className="form-section min-w-0 space-y-5">
    {result.value?.canEdit && <Link className={linkClass} href={`/cadastros/${kind}/novo`}>Novo cadastro</Link>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); setQuery({ q: String(values.get("q") || ""), status: String(values.get("status") || ""), offset: 0 }) }}>
      <label className="min-w-0 flex-1 space-y-2">Buscar nome ou código<Input name="q" maxLength={160} /></label>
      <label className="space-y-2">Situação<select name="status" className={selectClass}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></label>
      <Button type="submit" disabled={result.loading}>Buscar</Button>
    </form>
    {result.loading ? <p role="status">Carregando cadastros…</p> : result.error ? <div className="space-y-3" role="alert"><p><RequestError message={result.error} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button></div> : result.value && <>
      <p>{result.value.total} registro(s) · {result.value.canEdit ? "Consulta e edição" : "Somente consulta"}</p>
      {!result.value.data.length ? <p>Nenhum cadastro encontrado.</p> : <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{result.value.data.map(item => <li className="min-w-0 space-y-2 rounded-xl border p-4" key={item.id}>
        <Link className={`${linkClass} break-words`} href={`/cadastros/${kind}/${item.id}`}>{item.name}</Link><p className="break-all text-sm">{item.code}</p><p>{item.status === "active" ? "Ativo" : "Arquivado"}</p>
      </li>)}</ul>}
      <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" disabled={!query.offset} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 25) })}>Anterior</Button><span>Página {Math.floor(query.offset / 25) + 1}</span><Button variant="outline" disabled={query.offset + 25 >= result.value.total} onClick={() => setQuery({ ...query, offset: query.offset + 25 })}>Próxima</Button></div>
    </>}
  </section></>
}

function RecordAccess({ kind, id, mode }: { kind: ReferenceKind; id?: string; mode: "view" | "edit" | "create" }) {
  const config = referenceConfigs[kind]
  const result = useResource<ReferenceSnapshot | ReferenceList>(id ? `/api/erp/${config.endpoint}/${id}` : `/api/erp/${config.endpoint}?limit=1`)
  if (result.loading) return <p role="status">Carregando cadastro e permissões…</p>
  if (result.error || !result.value) return <><PageHeader eyebrow="Cadastros" title={config.title} description={config.description} /><section className="form-section space-y-3"><p role="alert"><RequestError message={result.error || "Cadastro indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button><Link className={linkClass} href={`/cadastros/${kind}`}>Voltar à listagem</Link></section></>
  const initial = id && !Array.isArray(result.value.data) ? result.value as ReferenceSnapshot : undefined
  if (mode === "view" && initial) return <Detail kind={kind} value={initial} />
  if (!result.value.canEdit) return <><PageHeader eyebrow="Cadastros" title={config.title} description={config.description} /><section className="form-section space-y-3"><p role="status">Somente consulta. Solicite permissão para alterar este cadastro.</p><Link className={linkClass} href={`/cadastros/${kind}`}>Voltar à listagem</Link></section></>
  return <Editor key={`${id || "new"}:${result.etag}`} kind={kind} initial={initial} tenantId={result.value.tenantId} etag={result.etag} reload={result.reload} />
}

function ParentName({ kind, id }: { kind: ReferenceKind; id: string }) {
  const result = useResource<ReferenceSnapshot>(`/api/erp/${referenceConfigs[kind].endpoint}/${id}`)
  return <span className="break-words">{result.loading ? "Consultando categoria…" : result.error ? `Categoria indisponível (${id})` : result.value?.data.name}</span>
}

function Detail({ kind, value }: { kind: ReferenceKind; value: ReferenceSnapshot }) {
  const config = referenceConfigs[kind], data = value.data
  const values = [["Código", data.code], ["Situação", data.status === "active" ? "Ativo" : "Arquivado"], ["Observações", data.notes || "Não informadas"]]
  if (kind === "categorias-produtos") values.push(["Ordem de exibição", String(data.sortOrder)])
  if (kind === "categorias-financeiras") values.push(["Natureza", data.direction === "income" ? "Receita" : "Despesa"])
  if (kind === "contas-financeiras") values.push(["Tipo de conta", accountTypes[data.accountType as keyof typeof accountTypes]], ["Banco", String(data.bank || "Não informado")], ["Agência", String(data.branch || "Não informada")], ["Número da conta", String(data.accountNumber || "Não informado")])
  if (kind === "formas-pagamento") values.push(["Modalidade", modalities[data.modality as keyof typeof modalities]], ["Prazo de referência (dias)", String(data.settlementDays)])
  return <><PageHeader eyebrow={`Cadastros · ${config.title}`} title={data.name} description={config.description} /><Link className={linkClass} href={`/cadastros/${kind}`}>Voltar à listagem</Link><section className="form-section mt-5 min-w-0 space-y-5">
    <p className="break-all text-xs text-muted-foreground">Empresa {value.tenantId} · Revisão {data.revision}</p>
    <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{values.map(([label, text]) => <div className="min-w-0" key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{text}</dd></div>)}
      {(kind === "categorias-produtos" || kind === "categorias-financeiras") && <div><dt className="text-sm text-muted-foreground">Categoria superior</dt><dd className="mt-1">{data.parentId ? <Link className={linkClass} href={`/cadastros/${kind}/${data.parentId}`}><ParentName kind={kind} id={String(data.parentId)} /></Link> : "Nenhuma"}</dd></div>}
    </dl>{value.canEdit ? <Link className={linkClass} href={`/cadastros/${kind}/${data.id}/editar`}>Editar cadastro</Link> : <p>Somente consulta.</p>}
  </section></>
}

function ParentPicker({ kind, id, selected, disabled, choose }: { kind: ReferenceKind; id?: string; selected: string | null; disabled: boolean; choose: (id: string | null) => void }) {
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "10", status: "active" })
  const result = useResource<ReferenceList>(`/api/erp/${referenceConfigs[kind].endpoint}?${params}`)
  return <section className="min-w-0 space-y-3 rounded-xl border p-4" aria-label="Seleção de categoria superior">
    <p>Categoria superior: {selected ? <ParentName kind={kind} id={selected} /> : "Nenhuma"}</p><Button type="button" variant="outline" disabled={disabled || !selected} onClick={() => choose(null)}>Sem categoria superior</Button>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery({ q: String(new FormData(event.currentTarget).get("q") || ""), offset: 0 }) }}><label className="min-w-0 flex-1 space-y-2">Buscar categoria superior<Input name="q" maxLength={160} disabled={disabled} /></label><Button type="submit" disabled={disabled || result.loading}>Pesquisar categoria</Button></form>
    {result.loading ? <p role="status">Consultando categorias…</p> : result.error ? <p role="alert"><RequestError message={result.error} status={result.status} /></p> : <>
      <ul className="space-y-2">{result.value?.data.filter(item => item.id !== id).map(item => <li key={item.id}><Button type="button" variant="outline" className="h-auto max-w-full whitespace-normal break-words text-left" disabled={disabled} onClick={() => choose(item.id)}>Usar {item.name} · {item.code}</Button></li>)}</ul>
      {!result.value?.data.filter(item => item.id !== id).length && <p>Nenhuma categoria disponível nesta página.</p>}
      <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" disabled={disabled || !query.offset} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 10) })}>Categorias anteriores</Button><Button type="button" variant="outline" disabled={disabled || query.offset + 10 >= (result.value?.total || 0)} onClick={() => setQuery({ ...query, offset: query.offset + 10 })}>Próximas categorias</Button></div>
    </>}
  </section>
}

function Editor({ kind, initial, tenantId, etag, reload }: { kind: ReferenceKind; initial?: ReferenceSnapshot; tenantId: string; etag: string; reload: () => void }) {
  const config = referenceConfigs[kind]
  const router = useRouter(), command = useCommand()
  const [draft, setDraft] = useState<ReferenceFields>(() => initial ? Object.fromEntries(Object.keys(config.defaults).map(key => [key, initial.data[key]])) as ReferenceFields : { ...config.defaults })
  const [dirty, setDirty] = useState(false)
  const frozen = command.busy || command.uncertain || command.stale
  const hierarchy = kind === "categorias-produtos" || kind === "categorias-financeiras"
  function change(key: string, value: string | number | null) { setDraft(previous => ({ ...previous, [key]: value })); setDirty(true) }
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || command.uncertain) event.preventDefault() }
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent)
  }, [dirty, command.uncertain])
  function input(key: string, label: string, max: number, required = false) { return <label key={key} className="block min-w-0 space-y-2">{label}<Input required={required} maxLength={max} value={String(draft[key] ?? "")} onChange={event => change(key, event.target.value || (required ? "" : null))} /></label> }
  function select(key: string, label: string, options: Record<string, string>) { return <label className="block min-w-0 space-y-2">{label}<select className={selectClass} value={String(draft[key])} onChange={event => change(key, event.target.value)}>{Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label> }
  return <><PageHeader eyebrow={`Cadastros · ${config.title}`} title={`${initial ? "Editar" : "Novo cadastro de"} ${config.singular}`} description={config.description} />
    <Link className={linkClass} href={initial ? `/cadastros/${kind}/${initial.data.id}` : `/cadastros/${kind}`} onClick={event => { if ((dirty || command.uncertain) && !window.confirm("Sair sem confirmar as alterações deste cadastro?")) event.preventDefault() }}>Voltar</Link>
    <section className="form-section mt-5 min-w-0 space-y-5">
      {hierarchy && <ParentPicker kind={kind} id={initial?.data.id} selected={draft.parentId as string | null} disabled={frozen} choose={id => change("parentId", id)} />}
      <form className="space-y-5" onSubmit={async event => {
        event.preventDefault()
        const value = await command.send<ReferenceSnapshot>(`/api/erp/${config.endpoint}${initial ? `/${initial.data.id}` : ""}`, tenantId, draft, initial ? etag : "", initial ? "PUT" : "POST")
        if (value) { setDirty(false); router.replace(`/cadastros/${kind}/${value.data.id}`) }
      }}>
        <fieldset disabled={frozen} className="grid min-w-0 gap-5 sm:grid-cols-2">
          {input("code", "Código", 40, true)}{input("name", "Nome", 200, true)}
          {kind === "categorias-produtos" && <label className="block min-w-0 space-y-2">Ordem de exibição<Input type="number" min={0} max={999999} step={1} required value={draft.sortOrder ?? ""} onChange={event => change("sortOrder", event.target.value === "" ? null : Number(event.target.value))} /></label>}
          {kind === "categorias-financeiras" && select("direction", "Natureza", { income: "Receita", expense: "Despesa" })}
          {kind === "contas-financeiras" && <>
            <label className="block min-w-0 space-y-2">Tipo de conta<select className={selectClass} value={String(draft.accountType)} onChange={event => { const accountType = event.target.value; setDraft(previous => ({ ...previous, accountType, ...(accountType !== "bank" ? { bank: null, branch: null, accountNumber: null } : {}) })); setDirty(true) }}>{Object.entries(accountTypes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            {draft.accountType === "bank" && <>{input("bank", "Banco", 100)}{input("branch", "Agência", 30)}{input("accountNumber", "Número da conta", 50)}</>}
          </>}
          {kind === "formas-pagamento" && <>{select("modality", "Modalidade", modalities)}<label className="block min-w-0 space-y-2">Prazo de referência (dias)<Input type="number" min={0} max={365} step={1} required value={draft.settlementDays ?? ""} onChange={event => change("settlementDays", event.target.value === "" ? null : Number(event.target.value))} /></label></>}
          {select("status", "Situação", { active: "Ativo", archived: "Arquivado" })}
          <label className="block min-w-0 space-y-2 sm:col-span-2">Observações<Input maxLength={1000} value={draft.notes || ""} onChange={event => change("notes", event.target.value || null)} /></label>
        </fieldset>
        {command.error && <p role="alert"><RequestError message={command.error} status={command.status} /></p>}
        {command.uncertain && <p role="status">Confirmação pendente. Conferir usa o mesmo comando.</p>}
        {command.stale && <Button type="button" variant="outline" onClick={() => { if (!dirty || window.confirm("Descartar sua edição e recarregar o cadastro atual?")) { command.reset(); reload() } }}>Recarregar cadastro</Button>}
        <Button type="submit" disabled={command.busy || command.stale || (!dirty && !!initial)}>{command.busy ? "Salvando…" : command.uncertain ? "Conferir gravação" : "Salvar cadastro"}</Button>
      </form>
    </section>
  </>
}
