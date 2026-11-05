"use client"
import Image from "next/image"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { erpFetch } from "@/lib/api/client"
import { useNavigationGuard } from "@/components/shell/navigation-guard"

type Profile = { revision: number; collection: string; muscleGroup: string; technicalCategory: string; dimensionsMm: number[]; description: string; weight: string; weightStack: string; publicPath: string; mainMediaId: string }
type Asset = { id: string; variant: string; version: number; width: number; height: number }
type Snapshot = { tenantId: string; canEdit: boolean; data: Profile; assets: Asset[] }
const labels: Record<string, string> = { source: "Original privado", black: "Apresentação em preto", webp: "WebP para o site", thumbnail: "Miniatura" }

export function CatalogProfile({ id, tenantId }: { id: string; tenantId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState("")
  const [retry, setRetry] = useState(0)
  const [newImage, setNewImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState("")
  const dirty = !!newImage || !!draft && JSON.stringify(draft) !== JSON.stringify(snapshot?.data)
  useNavigationGuard(dirty ? "Há alterações no catálogo ainda não salvas. Sair?" : null)
  useEffect(() => {
    const controller = new AbortController()
    erpFetch(`/api/erp/products/${id}/catalog`, { signal: controller.signal }).then(async response => {
      if (response.status === 404) return
      const value = await response.json()
      if (!response.ok) throw new Error(value.title || "Galeria indisponível")
      if (value.tenantId !== tenantId) throw new Error("A empresa mudou. Recarregue a ficha.")
      if (!controller.signal.aborted) { setSnapshot(value); setDraft(value.data); setPreview(value.data.mainMediaId); setError("") }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [id, tenantId, retry])
  if (!snapshot || !draft) return error ? <p role="alert">{error} <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Tentar novamente</Button></p> : null
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !snapshot) return
    setBusy(true); setError(""); setMessage("")
    const { revision, collection, muscleGroup, technicalCategory, dimensionsMm, description, weight, weightStack, mainMediaId } = draft
    const input = { collection, muscleGroup, technicalCategory, dimensionsMm, description, weight, weightStack, mainMediaId, ...(newImage ? { newImage } : {}) }
    try {
      const response = await erpFetch(`/api/erp/products/${id}/catalog`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId, "If-Match": `"${revision}"` }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.title || "Não foi possível salvar")
      const next = { ...draft, revision: result.revision, mainMediaId: result.mainMediaId }; setDraft(next); setSnapshot({ ...snapshot, data: next }); setNewImage(null); setImageName(""); setPreview(result.mainMediaId); setRetry(n => n + 1); setMessage("Rascunho salvo. Publique pelo catálogo de produtos quando estiver pronto.")
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao salvar") }
    finally { setBusy(false) }
  }
  return <section className="space-y-6 rounded-xl border p-4 sm:p-6" aria-label="Catálogo e biblioteca de imagens">
    <div><h2 className="text-xl font-semibold">Catálogo e imagens</h2><p className="mt-2 text-sm text-muted-foreground">Revise a apresentação do equipamento. Salvar não altera o site até você publicar o catálogo.</p></div>
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl bg-white p-4"><Image unoptimized src={newImage || `/api/erp/products/${id}/media/${preview}`} alt="Prévia da imagem selecionada" width={1200} height={1000} className="h-80 w-full object-contain sm:h-96" /></div>
        {snapshot.canEdit && <label className="grid gap-2 text-sm">Enviar nova foto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event => {
          const input = event.currentTarget, file = input.files?.[0]
          if (!file) return
          setError(""); setBusy(true)
          try {
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10_000_000) throw new Error("Escolha JPG, PNG ou WebP com até 10 MB.")
            const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler a foto.")); reader.readAsDataURL(file) })
            setNewImage(value); setImageName(file.name)
          } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao abrir a foto") }
          finally { input.value = ""; setBusy(false) }
        }} /><span className="text-muted-foreground">Até 10 MB, 16 megapixels e 6000 px por lado. O original fica privado; as versões WebP preservam as cores. Grave em “Salvar apresentação”.</span></label>}
        {newImage && <p className="text-sm">Foto pendente: {imageName} <Button type="button" variant="outline" disabled={busy} onClick={() => { setNewImage(null); setImageName("") }}>Descartar foto pendente</Button></p>}
        <div className="grid grid-cols-2 gap-3">{snapshot.assets.map(asset => <button key={asset.id} type="button" onClick={() => setPreview(asset.id)} aria-pressed={preview === asset.id} className={`rounded-lg border p-3 text-left ${preview === asset.id ? "border-primary ring-1 ring-primary" : ""}`}><Image unoptimized src={`/api/erp/products/${id}/media/${asset.id}`} alt={labels[asset.variant] || asset.variant} width={160} height={110} className="h-24 w-full rounded bg-white object-contain" /><strong className="mt-2 block text-sm">{labels[asset.variant] || asset.variant}</strong><span className="text-xs text-muted-foreground">{asset.width} × {asset.height} px · versão {asset.version}</span></button>)}</div>
      </div>
      <form className="space-y-4" onSubmit={save}>
        <fieldset disabled={!snapshot.canEdit || busy} className="space-y-4">
          <label className="grid gap-2">Linha<select className="rounded-lg border bg-background p-2" value={draft.collection} onChange={e => setDraft({ ...draft, collection: e.target.value })}><option value="core">Ludus Core</option><option value="premium">Ludus Premium</option></select></label>
          {([["muscleGroup", "Grupo corporal"], ["technicalCategory", "Categoria técnica"], ["weight", "Peso do equipamento"], ["weightStack", "Bateria de pesos"]] as const).map(([field, label]) => <label key={field} className="grid gap-2">{label}<Input maxLength={80} required={field === "muscleGroup" || field === "technicalCategory"} value={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.value })} /></label>)}
          <div className="grid grid-cols-3 gap-2">{["Profundidade", "Largura", "Altura"].map((label, i) => <label key={label} className="grid gap-2 text-sm">{label} (mm)<Input type="number" min={1} max={50000} step={1} required value={draft.dimensionsMm[i]} onChange={e => setDraft({ ...draft, dimensionsMm: draft.dimensionsMm.map((n, j) => i === j ? Number(e.target.value) : n) })} /></label>)}</div>
          <label className="grid gap-2">Descrição<textarea className="rounded-lg border bg-background p-3" rows={4} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          <label className="grid gap-2">Imagem principal no site<select className="rounded-lg border bg-background p-2" value={draft.mainMediaId} onChange={e => { setDraft({ ...draft, mainMediaId: e.target.value }); setPreview(e.target.value) }}>{snapshot.assets.filter(a => a.variant !== "source").map(a => <option key={a.id} value={a.id}>{labels[a.variant]} · versão {a.version}</option>)}</select></label>
          <p className="text-sm text-muted-foreground">Área de treino estimada: {((draft.dimensionsMm[0] / 1000 + 1.2) * (draft.dimensionsMm[1] / 1000 + 1.2)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m². Margem de 600 mm por lado para estudo preliminar, sujeita ao projeto.</p>
          <Button type="submit" disabled={!dirty || busy}>{busy ? "Salvando…" : "Salvar apresentação"}</Button>
        </fieldset>
        {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
      </form>
    </div>
  </section>
}
