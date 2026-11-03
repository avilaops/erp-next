import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Schema } from "@/lib/api/types"
import { blankIbptItem, type DraftItem, type IbptDraftSelection } from "./nfe-draft-model"

const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ")
const money = (value: string) => `R$ ${value.replace(".", ",")}`

export function IbptDraftFields({ selection, items, onChange }: { selection?: IbptDraftSelection | null; items: DraftItem[]; onChange: (value: IbptDraftSelection | null) => void }) {
  return <section className="form-section min-w-0 space-y-4" aria-label="Seleção da estimativa IBPT">
    <h2 className="text-lg font-semibold">Estimativa informativa IBPT</h2>
    <p className="text-sm text-muted-foreground">A estimativa informa a carga tributária aproximada e não altera os tributos da operação nem o total da NF-e. Escolha UF, data, EX e origem para cada item conforme a instrução fiscal. O servidor confirma os valores ao salvar, usando uma tabela configurada e válida. A base soma o valor bruto e o IPI declarado de cada item.</p>
    {selection ? <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid min-w-0 gap-2 text-sm">UF da estimativa IBPT<select aria-label="UF da estimativa IBPT" required className="min-h-10 min-w-0 rounded-lg border bg-background px-3" value={selection.uf} onChange={event => onChange({ ...selection, uf: event.target.value })}><option value="">Selecione</option>{states.map(state => <option key={state}>{state}</option>)}</select></label>
        <label className="grid min-w-0 gap-2 text-sm">Data de referência IBPT<Input required type="date" value={selection.asOf} onChange={event => onChange({ ...selection, asOf: event.target.value })} /></label>
      </div>
      <p className="text-xs text-muted-foreground">A data deve coincidir com a data de emissão.</p>
      {items.map((item, index) => {
        const choice = selection.items[index] || blankIbptItem()
        const change = (patch: Partial<typeof choice>) => onChange({ ...selection, items: selection.items.map((current, position) => position === index ? { ...current, ...patch } : current) })
        return <section key={index} className="min-w-0 space-y-3 rounded-xl border p-4" aria-label={`Seleção IBPT do item ${index + 1}`}>
          <h3 className="break-words font-medium">Item {index + 1} · {item.code || "Código pendente"} · NCM {item.ncm || "pendente"}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid min-w-0 gap-2 text-sm">EX IBPT do item {index + 1}<Input required inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} value={choice.ex} onChange={event => change({ ex: event.target.value })} /></label>
            <label className="grid min-w-0 gap-2 text-sm">Origem IBPT do item {index + 1}<select aria-label={`Origem IBPT do item ${index + 1}`} required className="min-h-10 w-full min-w-0 rounded-lg border bg-background px-3" value={choice.origin} onChange={event => change({ origin: event.target.value as typeof choice.origin })}><option value="">Selecione</option><option value="national">Nacional</option><option value="imported">Importado</option></select></label>
            <label className="grid min-w-0 gap-2 text-sm">Versão IBPT do item {index + 1} (opcional)<Input pattern={"[0-9]{2}\\.[0-9]\\.[A-Z]"} maxLength={6} value={choice.version || ""} onChange={event => change({ version: event.target.value || null })} /></label>
          </div>
        </section>
      })}
      <p className="text-xs text-muted-foreground">Deixe a versão em branco para consultar a versão mais recente válida para a data informada ou informe uma versão no formato 26.2.A. Informe o EX explicitamente, inclusive quando for 0. A origem IBPT é uma escolha própria e não é preenchida pelo CST ou pela origem da mercadoria.</p>
      <Button type="button" variant="outline" onClick={() => onChange(null)}>Remover estimativa IBPT</Button>
    </> : <Button type="button" variant="outline" onClick={() => onChange({ uf: "", asOf: "", items: items.map(blankIbptItem) })}>Adicionar estimativa IBPT</Button>}
  </section>
}

export function IbptSavedSnapshot({ snapshot, revision, dirty }: { snapshot: Schema<"IbptDocumentSnapshot">; revision: number; dirty: boolean }) {
  return <section className="form-section min-w-0 space-y-4" aria-label="Estimativa IBPT da revisão salva">
    <h2 className="text-lg font-semibold">Estimativa IBPT da revisão salva</h2>
    <p className="text-sm">Revisão salva {revision} · UF {snapshot.uf} · Data de referência {snapshot.asOf}</p>
    {dirty && <p role="status" className="text-sm text-amber-800 dark:text-amber-200">Há alterações não salvas. A estimativa exibida pertence à revisão salva.</p>}
    <p className="text-sm text-muted-foreground">Valores informativos confirmados ao salvar. Os tributos da operação e o total da NF-e permanecem os declarados.</p>
    {snapshot.items.map((item, index) => <section key={index} className="min-w-0 space-y-2 rounded-xl border p-4" aria-label={`Estimativa salva do item ${index + 1}`}>
      <h3 className="break-words font-medium">Item {index + 1} · {item.itemCode} · NCM {item.code} · EX {item.ex}</h3>
      <p className="text-sm">Origem: {item.origin === "national" ? "Nacional" : "Importado"} · Base: {money(item.amount)}</p>
      <Amounts amounts={item.amounts} />
      <p className="text-sm font-medium">Total estimado do item: {money(item.amounts.total)}</p>
      <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
        {[["Fonte", item.metadata.source], ["Versão", item.metadata.version], ["Chave da tabela", item.metadata.key], ["UF da tabela", item.metadata.uf], ["Início da vigência", item.metadata.validFrom], ["Fim da vigência", item.metadata.validTo], ["SHA-256", item.metadata.sha256]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}
      </dl>
    </section>)}
    <Amounts amounts={snapshot.amounts} />
    <p className="font-semibold">Total estimado IBPT: {money(snapshot.amounts.total)}</p>
  </section>
}

function Amounts({ amounts }: { amounts: Schema<"IbptAmounts"> }) {
  return <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><p>Federal: {money(amounts.federal)}</p><p>Estadual: {money(amounts.state)}</p><p>Municipal: {money(amounts.municipal)}</p></div>
}
