"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { AccessProblem, errorMessage, read, write, type Access, type Permission, type Role, type RoleDetail, type Snapshot } from "./access-client"

type Loaded = { access: Access; roles: Role[]; permissions: Permission[] }
async function load(signal?: AbortSignal): Promise<Loaded> {
  const { data: access } = await read<Access>("me", signal)
  const [roles, permissions] = await Promise.all([read<{ data: Role[] }>("roles", signal), read<{ data: Permission[] }>("permissions", signal)])
  return { access, roles: roles.data.data, permissions: permissions.data.data }
}

export function RolesManager() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [selected, setSelected] = useState<Snapshot<RoleDetail> | null>(null)
  const [creating, setCreating] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then((result) => { if (!controller.signal.aborted) setLoaded(result) }).catch((error) => { if (!controller.signal.aborted) setProblem(errorMessage(error)) })
    return () => controller.abort()
  }, [])
  async function choose(id?: string) {
    if (busy || (dirty && !window.confirm("Descartar a edição atual para abrir outro papel?"))) return
    setBusy(true); setProblem(""); setNotice(""); setSelected(null); setCreating(false)
    try { setSelected(id ? await read<RoleDetail>(`roles/${id}`) : null); setCreating(!id); setGeneration((current) => current + 1); setDirty(false) }
    catch (error) { setProblem(errorMessage(error)) }
    finally { setBusy(false) }
  }
  async function completed(id?: string) {
    setDirty(false)
    setLoaded(await load())
    setSelected(id ? await read<RoleDetail>(`roles/${id}`) : null)
    setCreating(false); setGeneration((current) => current + 1)
    setNotice(id ? "Papel salvo no servidor." : "Papel excluído no servidor.")
  }
  if (!loaded) return <section className="form-section"><p role={problem ? "alert" : "status"}>{problem || "Carregando papéis…"}</p>{problem && <Button onClick={() => window.location.reload()}>Tentar novamente</Button>}</section>
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">{loaded.roles.length} papéis em {loaded.access.tenant.legalName}. Só é possível delegar permissões que você possui.</p>
    {notice && <p role="status">{notice}</p>}{problem && <p role="alert">{problem}</p>}
    <div className="flex flex-wrap gap-3">{loaded.roles.map((role) => <Button className="h-auto max-w-full whitespace-normal break-all py-2 text-left" disabled={busy} variant={selected?.data.id === role.id ? "default" : "outline"} key={role.id} onClick={() => choose(role.id)}>{role.name}</Button>)}<Button disabled={busy || !loaded.access.permissions.includes("platform.roles.manage")} onClick={() => choose()}>Novo papel</Button></div>
    {(selected || creating) ? <RoleForm key={`${generation}-${selected?.data.id || "new"}`} loaded={loaded} snapshot={selected} onDirty={(value) => { setDirty(value); if (value) setNotice("") }} onBusy={setBusy} onComplete={completed} onReload={async () => { if (selected) { setSelected(await read<RoleDetail>(`roles/${selected.data.id}`)); setGeneration((current) => current + 1); setDirty(false) } else window.location.reload() }} /> : <p role="status">Selecione um papel para consultar suas permissões.</p>}
  </div>
}

function RoleForm({ loaded, snapshot, onDirty, onBusy, onComplete, onReload }: { loaded: Loaded; snapshot: Snapshot<RoleDetail> | null; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onComplete: (id?: string) => Promise<void>; onReload: () => Promise<void> }) {
  const [code, setCode] = useState(snapshot?.data.code || "")
  const [name, setName] = useState(snapshot?.data.name || "")
  const [description, setDescription] = useState(snapshot?.data.description || "")
  const [permissions, setPermissions] = useState(snapshot?.data.permissions || [])
  const [problem, setProblem] = useState("")
  const [conflict, setConflict] = useState(false)
  const [uncertainCreation, setUncertainCreation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [commandKey] = useState(() => crypto.randomUUID())
  const [dirty, setDirty] = useState(false)
  const canEdit = loaded.access.permissions.includes("platform.roles.manage") && (snapshot?.data.permissions || []).every((permission) => loaded.access.permissions.includes(permission))
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener("beforeunload", preventLoss)
    return () => window.removeEventListener("beforeunload", preventLoss)
  }, [dirty])
  function changed() { setDirty(true); onDirty(true) }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit || busy || conflict) return
    setBusy(true); onBusy(true); setProblem("")
    try {
      const result = await write<RoleDetail>(snapshot ? `roles/${snapshot.data.id}` : "roles", snapshot ? "PUT" : "POST", loaded.access.tenant.id, { code, name, description, permissions }, snapshot?.etag, snapshot ? undefined : commandKey)
      setDirty(false); onDirty(false)
      try { await onComplete(result.data.id) }
      catch { setProblem("Papel salvo no servidor. Não foi possível atualizar a consulta; recarregue a página para conferir seus acessos atuais."); setConflict(true) }
    } catch (error) {
      setProblem(errorMessage(error))
      const status = error instanceof AccessProblem ? error.status : 0
      if (snapshot) setConflict([0, 409, 412, 503].includes(status))
      else setUncertainCreation([0, 503].includes(status))
    } finally { setBusy(false); onBusy(false) }
  }
  async function remove() {
    if (!snapshot || busy || conflict || !window.confirm(`Excluir o papel ${snapshot.data.name}? Esta ação será auditada.`)) return
    setBusy(true); onBusy(true); setProblem("")
    try { await write(`roles/${snapshot.data.id}`, "DELETE", loaded.access.tenant.id, undefined, snapshot.etag); setDirty(false); onDirty(false); await onComplete() }
    catch (error) { setProblem(errorMessage(error)); setConflict(error instanceof AccessProblem && [0, 412, 503].includes(error.status)) }
    finally { setBusy(false); onBusy(false) }
  }
  return <form className="form-section space-y-5" onSubmit={submit} onChange={changed}>
    <h2 className="break-words text-xl font-semibold">{snapshot ? `Papel: ${snapshot.data.name}` : "Criar papel"}</h2>
    <p className="text-sm text-muted-foreground">{snapshot ? `Revisão ${snapshot.data.revision}` : "A criação usa uma chave de idempotência para evitar duplicação no reenvio."}</p>
    {!canEdit && <p role="status">Acesso somente de consulta. Você não possui todas as permissões necessárias para alterar este papel.</p>}
    {problem && <div className="space-y-3" role="alert"><p>{problem}</p>{conflict && <Button type="button" variant="outline" disabled={busy} onClick={async () => { if (!window.confirm("Recarregar e descartar sua edição?")) return; try { await onReload() } catch (error) { setProblem(errorMessage(error)) } }}>Recarregar e descartar edição</Button>}</div>}
    {uncertainCreation && <p role="status">A confirmação falhou. Reenvie a mesma criação com a mesma chave antes de começar outra.</p>}
    <fieldset disabled={!canEdit || busy || conflict || uncertainCreation} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><label>Código do papel<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" required maxLength={80} pattern="(?:[a-z0-9_]|-)+" value={code} onChange={(event) => setCode(event.target.value)} /></label><label>Nome do papel<input className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 w-full" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label></div>
      <label className="block">Descrição do papel<textarea className="min-h-10 min-w-0 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-60 mt-2 min-h-24 w-full" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <fieldset className="space-y-3"><legend className="mb-3 font-semibold">Permissões</legend><p className="text-sm text-muted-foreground">Gerenciar um recurso exige também sua permissão de consulta.</p>{loaded.permissions.map((permission) => <label key={permission.code} className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={permissions.includes(permission.code)} disabled={!loaded.access.permissions.includes(permission.code)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} /><span className="min-w-0 break-words">{permission.description}<small className="block break-all text-muted-foreground">{permission.code}</small></span></label>)}</fieldset>
    </fieldset>
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!canEdit || busy || conflict || (!dirty && !uncertainCreation)}>{busy ? "Salvando…" : uncertainCreation ? "Reenviar mesma criação" : "Salvar papel"}</Button>{snapshot && <Button type="button" variant="outline" disabled={!canEdit || busy || conflict} onClick={remove}>Excluir papel</Button>}</div>
  </form>
}
