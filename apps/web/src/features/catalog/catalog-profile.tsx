"use client"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { erpFetch } from "@/lib/api/client"
import { useNavigationGuard } from "@/components/shell/navigation-guard"
import { CatalogProfileFields } from "./catalog-profile-fields"
import { catalogProfileDraft, catalogSourceLink, sameCatalogProfile, type CatalogProfileData, type CatalogProfileInput, type CatalogProfileSnapshot } from "./catalog-profile-model"

const assetLabels: Record<string, string> = { source: "Original privado", black: "Apresentação em preto", webp: "Imagem para o site", thumbnail: "Miniatura" }

export function CatalogProfile({ id, tenantId, edit = false, canEdit: productCanEdit = false }: { id: string; tenantId: string; edit?: boolean; canEdit?: boolean }) {
  const [snapshot, setSnapshot] = useState<CatalogProfileSnapshot | null>(null)
  const [draft, setDraft] = useState<CatalogProfileInput | null>(null)
  const [baseline, setBaseline] = useState<CatalogProfileInput | null>(null)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [retry, setRetry] = useState(0)
  const [newImage, setNewImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState("")
  const [preview, setPreview] = useState("")
  const pending = useRef(false)
  const active = useRef(true)
  const dirty = !!newImage || !!draft && !!baseline && !sameCatalogProfile(draft, baseline)
  useNavigationGuard(dirty || uncertain || busy ? "Há alterações na ficha técnica ainda não salvas. Sair?" : null)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  async function read(signal?: AbortSignal): Promise<CatalogProfileSnapshot> {
    const response = await erpFetch(`/api/erp/products/${id}/catalog`, { cache: "no-store", signal })
    if (response.status === 404) return { tenantId, productId: id, canEdit: productCanEdit, data: null, assets: [], defaultCollection: "core", mediaConfigured: false }
    const value = await response.json()
    if (!response.ok) throw new Error(value.title || "Não foi possível carregar a ficha técnica.")
    if (value.tenantId !== tenantId || value.productId && value.productId !== id) throw new Error("A empresa ou o produto mudou. Recarregue o cadastro.")
    return { ...value, canEdit: !!value.canEdit && productCanEdit }
  }
  function apply(value: CatalogProfileSnapshot) {
    const input = catalogProfileDraft(value.data, value.defaultCollection)
    setSnapshot(value); setDraft(input); setBaseline(input); setEditing(edit && value.canEdit)
    setPreview(value.data?.mainMediaId || value.assets.find(asset => asset.variant === "webp")?.id || "")
    setNewImage(null); setImageName(""); setConflict(false); setUncertain(false)
  }
  useEffect(() => {
    const controller = new AbortController()
    read(controller.signal).then(value => { if (!controller.signal.aborted) { apply(value); setError("") } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Ficha indisponível.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // The keyed parent remounts this component when product or tenant changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tenantId, retry, productCanEdit, edit])

  function reload() {
    if (pending.current) return
    if ((dirty || uncertain) && !window.confirm("Descartar sua edição e carregar a ficha técnica do servidor?")) return
    setLoading(true); setRetry(value => value + 1)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!draft || !snapshot?.canEdit || pending.current || conflict || uncertain) return
    pending.current = true; setBusy(true); setError(""); setMessage("")
    const input = { ...draft, ...(newImage ? { newImage } : {}) }
    const expected = snapshot.data?.revision || 0
    let confirmed = false
    try {
      const response = await erpFetch(`/api/erp/products/${id}/catalog`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `"${expected}"` }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!active.current) return
      if (!response.ok) {
        setConflict(response.status === 412)
        if (response.status >= 500) setUncertain(true)
        if (response.status === 403) setSnapshot({ ...snapshot, canEdit: false })
        setError(result.title || "Não foi possível salvar a ficha técnica.")
        return
      }
      if (!Number.isSafeInteger(result.revision) || result.revision <= expected) throw new Error("Confirmação incompleta")
      confirmed = true
      const saved: CatalogProfileData = { ...draft, revision: result.revision, mainMediaId: result.mainMediaId ?? null, publicPath: snapshot.data?.publicPath || `/${draft.collection === "core" ? "core" : "loja"}/product-${id}/` }
      apply({ ...snapshot, data: saved })
      try { const value = await read(); if (active.current && value.data) apply(value) } catch { if (active.current) setError("A ficha foi salva. Não foi possível atualizar a consulta; tente recarregar.") }
      if (active.current) setMessage("Ficha técnica salva.")
    } catch {
      if (active.current && !confirmed) { setUncertain(true); setError("Não foi possível confirmar a gravação. Sua edição foi preservada.") }
    } finally { pending.current = false; if (active.current) setBusy(false) }
  }
  async function checkSave() {
    if (!draft || !snapshot || pending.current) return
    pending.current = true; setBusy(true); setError("")
    try {
      const value = await read()
      if (!active.current) return
      if (value.data && !newImage && sameCatalogProfile(catalogProfileDraft(value.data), draft)) { apply(value); setMessage("Ficha técnica salva e conferida.") }
      else if ((!value.data && !snapshot.data) || (value.data && snapshot.data && value.data.revision === snapshot.data.revision && baseline && sameCatalogProfile(catalogProfileDraft(value.data), baseline))) { setUncertain(false); setError("A gravação ainda não foi confirmada. Sua edição foi preservada; você pode tentar salvar novamente.") }
      else { setUncertain(false); setConflict(true); setError("A ficha no servidor é diferente. Confira antes de recarregar; sua edição foi preservada.") }
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "Não foi possível conferir a gravação.") }
    finally { pending.current = false; if (active.current) setBusy(false) }
  }

  return <section className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="Ficha técnica">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Ficha técnica</h2><p className="text-xs text-muted-foreground">Identificação, medidas e informações do fabricante.</p></div>{snapshot?.canEdit && !editing && <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setMessage("") }}>{snapshot.data ? "Editar ficha técnica" : "Adicionar ficha técnica"}</Button>}</div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Carregando ficha técnica…</p> : snapshot && draft && <>
      {editing ? <form aria-label="Ficha técnica do produto" className="min-w-0 space-y-3" onSubmit={save}>
        <CatalogProfileFields draft={draft} disabled={!snapshot.canEdit || busy || uncertain} onChange={value => { setDraft(value); setMessage("") }} />
        {snapshot.mediaConfigured && <label className="grid min-w-0 gap-1 text-sm">Imagem principal no site<select className="h-9 min-w-0 w-full rounded-lg border bg-background px-2" disabled={busy || uncertain} value={draft.mainMediaId || ""} onChange={event => { setDraft({ ...draft, mainMediaId: event.target.value || null }); setPreview(event.target.value); setMessage("") }}><option value="">Manter foto do cadastro</option>{snapshot.assets.filter(asset => asset.variant !== "source").map(asset => <option key={asset.id} value={asset.id}>{assetLabels[asset.variant] || asset.variant} · versão {asset.version}</option>)}</select></label>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!snapshot.canEdit || !dirty || busy || conflict || uncertain}>{busy ? "Salvando…" : "Salvar ficha técnica"}</Button><Button type="button" variant="outline" disabled={busy || uncertain} onClick={() => { if (baseline) setDraft(baseline); setNewImage(null); setImageName(""); setEditing(false); setError(""); setConflict(false); setMessage("") }}>Cancelar edição</Button></div>
      </form> : snapshot.data ? <TechnicalSummary value={snapshot.data} /> : <p className="text-sm text-muted-foreground">Ficha técnica ainda não preenchida.</p>}
      {snapshot.mediaConfigured && <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Imagens do catálogo ({snapshot.assets.length})</summary><div className="mt-3 min-w-0 space-y-3">
        {(newImage || preview) && <Image unoptimized src={newImage || `/api/erp/products/${id}/media/${preview}`} alt="Prévia da imagem selecionada" width={1200} height={1000} className="h-48 w-full rounded-lg bg-white object-contain" />}
        {snapshot.canEdit && <label className="grid min-w-0 gap-1 text-sm">Enviar nova foto<input className="block min-w-0 w-full" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uncertain} onChange={async event => {
          const field = event.currentTarget, file = field.files?.[0]
          if (!file || pending.current) return
          pending.current = true; setError(""); setBusy(true)
          try {
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) throw new Error("Escolha JPG, PNG ou WebP com até 10 MB.")
            const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler a foto.")); reader.readAsDataURL(file) })
            if (active.current) { setNewImage(value); setImageName(file.name); setEditing(true); setMessage("") }
          } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "Falha ao abrir a foto.") }
          finally { pending.current = false; field.value = ""; if (active.current) setBusy(false) }
        }} /><span className="text-xs text-muted-foreground">Até 10 MB. A foto é gravada junto da ficha técnica; a publicação do site é uma ação separada.</span></label>}
        {newImage && <p className="text-sm">Foto pendente: {imageName} <Button type="button" variant="outline" size="sm" disabled={busy || uncertain} onClick={() => { setNewImage(null); setImageName("") }}>Descartar foto pendente</Button></p>}
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">{snapshot.assets.map(asset => <button key={asset.id} type="button" onClick={() => setPreview(asset.id)} aria-pressed={preview === asset.id} className={`min-w-0 rounded-lg border p-2 text-left ${preview === asset.id ? "border-primary ring-1 ring-primary" : ""}`}><Image unoptimized src={`/api/erp/products/${id}/media/${asset.id}`} alt={assetLabels[asset.variant] || asset.variant} width={160} height={110} className="h-20 w-full rounded bg-white object-contain" /><strong className="mt-1 block text-xs">{assetLabels[asset.variant] || asset.variant}</strong><span className="text-xs text-muted-foreground">{asset.width} × {asset.height} px · v{asset.version}</span></button>)}</div>
      </div></details>}
    </>}
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p>{uncertain ? <Button type="button" variant="outline" disabled={busy} onClick={checkSave}>Conferir gravação</Button> : <Button type="button" variant="outline" disabled={busy} onClick={reload}>{conflict ? "Recarregar ficha" : "Tentar novamente"}</Button>}</div>}
    {message && <p role="status" className="text-sm text-primary">{message}</p>}
  </section>
}

function TechnicalSummary({ value }: { value: CatalogProfileData }) {
  return <div className="min-w-0 space-y-3">
    <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">{[["Fabricante", value.manufacturer], ["Modelo do fabricante", value.manufacturerModel], ["Nome no catálogo", value.catalogProductName], ["Grupo corporal", value.muscleGroup], ["Categoria técnica", value.technicalCategory], ["Peso", value.weight], ["Bateria de pesos", value.weightStack], ["Dimensões (C × L × A)", `${value.dimensionsMm.join(" × ")} mm`], ["Área de treino publicada", value.liveArea]].map(([label, content]) => <div key={label} className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{content || "Não informado"}</dd></div>)}</dl>
    {value.description && <details className="min-w-0 border-t pt-2"><summary className="cursor-pointer text-sm font-medium">Descrição do equipamento</summary><p className="mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{value.description}</p></details>}
    {!!value.catalogSources?.length && <div className="min-w-0 space-y-1 border-t pt-2 text-xs"><p className="font-medium">Fontes do catálogo</p>{value.catalogSources.map((source, index) => <p key={index} className="[overflow-wrap:anywhere]">{catalogSourceLink(source.url) ? <a className="text-primary underline underline-offset-4" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}{source.pdfPage && ` · PDF pág. ${source.pdfPage}`}{source.printedPage && ` · impressa pág. ${source.printedPage}`}</p>)}</div>}
  </div>
}
