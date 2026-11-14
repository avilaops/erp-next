"use client"
import { useReferenceHierarchy } from "./use-reference-hierarchy"
import { availableParents } from "./reference-hierarchy"
import { EntityListPage, SearchToolbar, FilterField, StatusBadge, EmptyState, ResponsiveTable, SortableTableHeader } from "@/components/workspace/list-layout"
import { useTableSort } from "@/components/workspace/use-table-sort"
import { registryQueryString, registrySortFields } from "../registry-query"
import { useRegistryQuery } from "../use-registry-query"
import "../compact-form.css"
import { Pagination } from "@/components/workspace/pagination"
import { DataTable } from "@/components/workspace/data-table"

import { RequestError } from "@/components/feedback/session-recovery"

import { GuardedLink as Link, useNavigationGuard, useListNavigationHref } from "@/components/shell/navigation-guard"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"
import { PageHeader } from "@/components/page-header"
import { RecordCompany } from "@/components/record-company"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/search-input"
import { Input } from "@/components/ui/input"
import { useCommand, useResource } from "@/hooks/use-operation"
import { accountTypes, modalities, referenceConfigs, referencePath, type ReferenceKind, type ReferenceFields, type ReferenceList, type ReferenceSnapshot } from "./reference-config"

const linkClass = "font-medium text-primary underline underline-offset-4"
const selectClass = "block h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"

export function ReferenceWorkspace({ kind, id, mode }: { kind: ReferenceKind; id?: string; mode: "list" | "view" | "edit" | "create" }) {
  return mode === "list" ? <List kind={kind} /> : <RecordAccess kind={kind} id={id} mode={mode} />
}

const warehouseSortFields = [...registrySortFields.reference, "location"]

function List({ kind }: { kind: ReferenceKind }) {
 const config = referenceConfigs[kind]
 const allowedSort = kind === "depositos" ? warehouseSortFields : registrySortFields.reference
 const { query, navigate } = useRegistryQuery("reference", allowedSort)
 const { sort, toggle } = useTableSort(allowedSort, { by: "name", order: "asc" })
 const params = new URLSearchParams(registryQueryString(query))
 params.set("limit", "25")
 const result = useResource<ReferenceList>(`/api/erp/${config.endpoint}?${params}`)
 const hierarchical = kind === "categorias-produtos" || kind === "categorias-financeiras"
 const tree = useReferenceHierarchy(kind === "categorias-financeiras" ? "financial-categories" : "product-categories", hierarchical ? result.value?.tenantId : undefined)
 const paths = new Map(tree.options.map(row => [row.id, row.path]))
 const total = result.value?.total ?? 0
 const filtered = !!(query.q || query.status)
 const create = result.value?.canEdit ? <Link className={linkClass} href={`${referencePath(kind)}/novo`}>Novo cadastro</Link> : undefined
 function search(value: typeof query) { if (!navigate(value)) result.reload() }
 function searchForm(q: string, form: HTMLFormElement | null) { search({ ...query, q, role: "", status: String(form ? new FormData(form).get("status") || "" : query.status), offset: 0 }) }
 return <EntityListPage title={config.title} description={config.description} actions={create} toolbar={
  <SearchToolbar pending={result.loading} canClear={filtered} onClear={() => search({ ...query, q: "", status: "", role: "", offset: 0 })} onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); search({ ...query, q: String(fields.get("q") || ""), status: String(fields.get("status") || ""), role: "", offset: 0 }) }}>
   <FilterField label="Buscar nome ou código"><SearchInput defaultValue={query.q} onSearch={searchForm} name="q" placeholder="Nome ou código" maxLength={160} /></FilterField>
   <FilterField label="Situação"><select key={query.status} name="status" defaultValue={query.status} className={selectClass}><option value="">Todas</option><option value="active">Ativos</option><option value="archived">Arquivados</option></select></FilterField>
  </SearchToolbar>
 } summary={!result.loading && !result.error && result.value && <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p role="status">{total} registro(s)</p><span className="text-muted-foreground">{result.value.canEdit ? "Consulta e edição" : "Somente consulta"}</span></div>}
  footer={!result.loading && !result.error && result.value && <Pagination offset={query.offset} pageSize={25} total={total} onOffsetChange={offset => search({ ...query, offset })} />}>
  {result.loading ? <p role="status" className="py-5 text-center text-sm text-muted-foreground">Carregando cadastros…</p> : result.error ? <div className="space-y-2 rounded-lg border border-destructive/30 p-3" role="alert"><RequestError message={result.error} status={result.status} /><Button onClick={result.reload}>Tentar novamente</Button></div> : result.value && <>
   {hierarchical && tree.error && <div role="status" className="space-y-1 text-xs text-muted-foreground"><p>{tree.error}</p><Button type="button" variant="outline" className="h-8 text-xs" onClick={tree.reload}>Atualizar hierarquia</Button></div>}
   <ResponsiveTable label={`Lista de ${config.title}`}><DataTable>
    <caption className="sr-only">{config.title} da empresa ativa</caption>
    <thead><tr><SortableTableHeader field="code" sort={sort} onSort={toggle}>Código</SortableTableHeader><SortableTableHeader field="name" sort={sort} onSort={toggle}>Nome</SortableTableHeader>{kind === "depositos" && <SortableTableHeader field="location" sort={sort} onSort={toggle}>Localização</SortableTableHeader>}<SortableTableHeader field="status" sort={sort} onSort={toggle}>Situação</SortableTableHeader><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
    <tbody>{result.value.data.map(item => <tr key={item.id}>
     <td className="font-mono text-xs [overflow-wrap:anywhere]">{item.code}</td>
     <th scope="row" className="min-w-52 align-top font-medium [overflow-wrap:anywhere]"><Link className={linkClass} href={`${referencePath(kind)}/${item.id}`}>{item.name}</Link>{paths.get(item.id) && paths.get(item.id) !== item.name && <p className="mt-1 text-xs font-normal text-muted-foreground">{paths.get(item.id)}</p>}</th>
     {kind === "depositos" && <td className="[overflow-wrap:anywhere]">{item.location || "Não informada"}</td>}
     <td className="align-top"><StatusBadge tone={item.status === "active" ? "success" : "neutral"}>{item.status === "active" ? "Ativo" : "Arquivado"}</StatusBadge></td>
     <td>{result.value?.canEdit && <Link className="inline-flex min-h-9 items-center text-primary underline" aria-label={`Editar ${item.name}`} href={`${referencePath(kind)}/${item.id}/editar`}>Editar</Link>}</td>
    </tr>)}</tbody>
   </DataTable></ResponsiveTable>
   {!result.value.data.length && <EmptyState filtered={filtered} action={create} />}
  </>}
 </EntityListPage>
}

function RecordAccess({ kind, id, mode }: { kind: ReferenceKind; id?: string; mode: "view" | "edit" | "create" }) {
  const config = referenceConfigs[kind]
  const result = useResource<ReferenceSnapshot | ReferenceList>(id ? `/api/erp/${config.endpoint}/${id}` : `/api/erp/${config.endpoint}?limit=1`)
  if (result.loading) return <p role="status">Carregando cadastro e permissões…</p>
  if (result.error || !result.value) return <><PageHeader eyebrow="Cadastros" title={config.title} description={config.description} /><section className="form-section space-y-3"><p role="alert"><RequestError message={result.error || "Cadastro indisponível"} status={result.status} /></p><Button onClick={result.reload}>Tentar novamente</Button><Link className={linkClass} href={`${referencePath(kind)}`}>Voltar à listagem</Link></section></>
  const initial = id && !Array.isArray(result.value.data) ? result.value as ReferenceSnapshot : undefined
  if (mode === "view" && initial) return <Detail kind={kind} value={initial} />
  if (!result.value.canEdit) return <><PageHeader eyebrow="Cadastros" title={config.title} description={config.description} /><section className="form-section space-y-3"><p role="status">Somente consulta. Solicite permissão para alterar este cadastro.</p><Link className={linkClass} href={`${referencePath(kind)}`}>Voltar à listagem</Link></section></>
  return <Editor key={`${id || "new"}:${result.etag}`} kind={kind} initial={initial} tenantId={result.value.tenantId} etag={result.etag} reload={result.reload} />
}

function ParentName({ kind, id }: { kind: ReferenceKind; id: string }) {
  const result = useResource<ReferenceSnapshot>(`/api/erp/${referenceConfigs[kind].endpoint}/${id}`)
  return <span className="break-words">{result.loading ? "Consultando categoria…" : result.error ? `Categoria indisponível (${id})` : result.value?.data.name}</span>
}

function Detail({ kind, value }: { kind: ReferenceKind; value: ReferenceSnapshot }) {
  const config = referenceConfigs[kind], data = value.data
  const values = [["Código", data.code], ["Situação", data.status === "active" ? "Ativo" : "Arquivado"], ["Observações", data.notes || "Não informadas"]]
  if (kind === "depositos") values.push(["Localização", String(data.location || "Não informada")])
  if (kind === "categorias-produtos") values.push(["Ordem de exibição", String(data.sortOrder)])
  if (kind === "categorias-financeiras") values.push(["Natureza", data.direction === "income" ? "Receita" : "Despesa"])
  if (kind === "contas-financeiras") values.push(["Tipo de conta", accountTypes[data.accountType as keyof typeof accountTypes]], ["Banco", String(data.bank || "Não informado")], ["Agência", String(data.branch || "Não informada")], ["Número da conta", String(data.accountNumber || "Não informado")])
  if (kind === "formas-pagamento") values.push(["Modalidade", modalities[data.modality as keyof typeof modalities]], ["Prazo de referência (dias)", String(data.settlementDays)])
  return <><PageHeader eyebrow={`Cadastros · ${config.title}`} title={data.name} description={config.description} /><Link className={linkClass} href={`${referencePath(kind)}`}>Voltar à listagem</Link><section className="compact-records form-section mt-3 min-w-0 space-y-3">
    <RecordCompany key={value.tenantId} tenantId={value.tenantId} />
    <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{values.map(([label, text]) => <div className="min-w-0" key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{text}</dd></div>)}
      {(kind === "categorias-produtos" || kind === "categorias-financeiras") && <div><dt className="text-sm text-muted-foreground">Categoria superior</dt><dd className="mt-1">{data.parentId ? <Link className={linkClass} href={`${referencePath(kind)}/${data.parentId}`}><ParentName kind={kind} id={String(data.parentId)} /></Link> : "Nenhuma"}</dd></div>}
      {kind === "tags" && <div><dt className="text-sm text-muted-foreground">Grupo de tags</dt><dd>{data.groupId ? <ParentName kind="grupos-tags" id={String(data.groupId)} /> : "Sem grupo"}</dd></div>}
    </dl>{value.canEdit ? <Link className={linkClass} href={`${referencePath(kind)}/${data.id}/editar`}>Editar cadastro</Link> : <p>Somente consulta.</p>}
  </section></>
}

function ParentPicker({ kind, id, selected, disabled, choose, tenantId, direction }: { kind: ReferenceKind; id?: string; selected: string | null; disabled: boolean; choose: (id: string | null) => void; tenantId: string; direction?: string | null }) {
 const fieldId = useId()
 const [query, setQuery] = useState("")
 const hierarchy = useReferenceHierarchy(kind === "categorias-financeiras" ? "financial-categories" : "product-categories", tenantId)
 const options = availableParents(hierarchy.options, id, direction)
 const current = hierarchy.options.find(row => row.id === selected)
 const matches = options.filter(row => `${row.path} ${row.code || ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")))
 return <section className="grid min-w-0 gap-2 rounded-lg border p-3" aria-label="Seleção de categoria superior">
  <label className="grid min-w-0 gap-1 text-sm">Buscar categoria superior<SearchInput maxLength={160} disabled={disabled} onSearch={value => setQuery(value)} /></label>
  <label htmlFor={fieldId} className="text-sm">Categoria superior</label>
  <select id={fieldId} className={selectClass} value={selected || ""} disabled={disabled || hierarchy.loading || !!hierarchy.error} onChange={event => choose(event.target.value || null)}>
   <option value="">Sem categoria superior</option>
   {selected && !matches.some(row => row.id === selected) && <option value={selected} disabled>{current?.path || "Categoria atual"} (vínculo atual)</option>}
   {matches.map(row => <option value={row.id} key={row.id}>{row.path}</option>)}
  </select>
  {hierarchy.loading && <p role="status" className="text-xs text-muted-foreground">Carregando categorias…</p>}
  {hierarchy.error && <p role="alert" className="text-sm">{hierarchy.error}</p>}
  <div className="flex flex-wrap items-center gap-3 text-sm"><Button type="button" variant="outline" className="h-8 px-2 text-xs" disabled={disabled || !selected} onClick={() => choose(null)}>Remover vínculo</Button><Button type="button" variant="outline" className="h-8 px-2 text-xs" disabled={disabled || hierarchy.loading} onClick={hierarchy.reload}>Atualizar categorias</Button><Link className={linkClass} href={`${referencePath(kind)}/novo`} target="_blank" rel="noopener noreferrer">Nova categoria</Link></div>
 </section>
}

function TagGroupPicker({ selected, disabled, choose }: { selected: string | null; disabled: boolean; choose: (id: string | null) => void }) {
  const [query, setQuery] = useState({ q: "", offset: 0 })
  const params = new URLSearchParams({ q: query.q, offset: String(query.offset), limit: "10", status: "active" })
  const result = useResource<ReferenceList>(`/api/erp/tag-groups?${params}`)
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Seleção de grupo de tags">
    <p>Grupo de tags: {selected ? <ParentName kind="grupos-tags" id={selected} /> : "Sem grupo"}</p>
    <Button type="button" variant="outline" disabled={disabled || !selected} onClick={() => choose(null)}>Remover grupo</Button>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setQuery({ q: String(new FormData(event.currentTarget).get("q") || ""), offset: 0 }) }}>
      <label className="min-w-0 flex-1 space-y-2">Buscar grupo de tags<SearchInput onSearch={q => setQuery({ q, offset: 0 })} name="q" maxLength={160} disabled={disabled} /></label>
      <Button type="submit" disabled={disabled || result.loading}>Pesquisar grupo</Button>
    </form>
    {result.loading ? <p role="status">Carregando grupos…</p> : result.error ? <div role="alert"><RequestError message={result.error} status={result.status} /><Button type="button" onClick={result.reload}>Tentar novamente</Button></div> : <>
      <ul className="space-y-2">{result.value?.data.map(group => <li key={group.id}><Button type="button" variant="outline" className="h-auto max-w-full whitespace-normal break-words" disabled={disabled} onClick={() => choose(group.id)}>Usar {group.name} · {group.code}</Button></li>)}</ul>
      {!result.value?.data.length && <p>Nenhum grupo ativo encontrado.</p>}
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={disabled || query.offset === 0} onClick={() => setQuery({ ...query, offset: query.offset - 10 })}>Grupos anteriores</Button><Button type="button" variant="outline" disabled={disabled || !result.value || query.offset + 10 >= result.value.total} onClick={() => setQuery({ ...query, offset: query.offset + 10 })}>Próximos grupos</Button></div>
      <Link className={linkClass} href="/cadastros/grupos-tags/novo" target="_blank" rel="noopener noreferrer">Cadastrar grupo de tags</Link>
    </>}
  </section>
}

function Editor({ kind, initial, tenantId, etag, reload }: { kind: ReferenceKind; initial?: ReferenceSnapshot; tenantId: string; etag: string; reload: () => void }) {
  const config = referenceConfigs[kind]
  const router = useRouter(), command = useCommand()
  const listHref = useListNavigationHref()
  const [draft, setDraft] = useState<ReferenceFields>(() => initial ? Object.fromEntries(Object.keys(config.defaults).map(key => [key, initial.data[key]])) as ReferenceFields : { ...config.defaults })
  const [dirty, setDirty] = useState(false)
  const frozen = command.busy || command.uncertain || command.stale
  useNavigationGuard(dirty || command.uncertain ? "Sair sem confirmar as alterações deste cadastro?" : null)
  const hierarchy = kind === "categorias-produtos" || kind === "categorias-financeiras"
  function change(key: string, value: string | number | null) { setDraft(previous => ({ ...previous, [key]: value, ...(key === "direction" && previous.direction !== value ? { parentId: null } : {}) })); setDirty(true) }
  function input(key: string, label: string, max: number, required = false) { return <label key={key} className="block min-w-0 space-y-2">{label}<Input required={required} maxLength={max} value={String(draft[key] ?? "")} onChange={event => change(key, event.target.value || (required ? "" : null))} /></label> }
  function select(key: string, label: string, options: Record<string, string>) { return <label className="block min-w-0 space-y-2">{label}<select className={selectClass} value={String(draft[key])} onChange={event => change(key, event.target.value)}>{Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label> }
  return <><PageHeader eyebrow={`Cadastros · ${config.title}`} title={`${initial ? "Editar" : "Novo cadastro de"} ${config.singular}`} description={config.description} />
    <Link className={linkClass} href={initial ? `${referencePath(kind)}/${initial.data.id}` : referencePath(kind)}>Voltar</Link>
    <section className="compact-records form-section mt-3 min-w-0 space-y-3">
      {kind === "tags" && <TagGroupPicker selected={draft.groupId as string | null} disabled={frozen} choose={id => change("groupId", id)} />}
      {hierarchy && <ParentPicker tenantId={tenantId} direction={kind === "categorias-financeiras" ? String(draft.direction) : null} kind={kind} id={initial?.data.id} selected={draft.parentId as string | null} disabled={frozen} choose={id => change("parentId", id)} />}
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault()
        const value = await command.send<ReferenceSnapshot>(`/api/erp/${config.endpoint}${initial ? `/${initial.data.id}` : ""}`, tenantId, draft, initial ? etag : "", initial ? "PUT" : "POST")
        if (value) { setDirty(false); router.replace(listHref(`${referencePath(kind)}/${value.data.id}`)) }
      }}>
        <fieldset disabled={frozen} className="grid min-w-0 gap-3 sm:grid-cols-2">
          {kind === "depositos" && input("location", "Localização", 200)}
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
        <Button type="submit" disabled={command.busy || command.stale || (!dirty && !!initial && !command.uncertain)}>{command.busy ? "Salvando…" : command.uncertain ? "Conferir gravação" : "Salvar cadastro"}</Button>
      </form>
    </section>
  </>
}
