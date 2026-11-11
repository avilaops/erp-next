import { GuardedLink as Link } from "@/components/shell/navigation-guard"
import { Button } from "@/components/ui/button"
import type { PriceTable } from "./negotiation-types"
import { commercialSimulationHref, type CommercialTableQuery } from "./commercial-navigation-model"

export function CommercialTableCart({ query, data, canOpen, onChange, onClear }: { query: CommercialTableQuery; data: PriceTable["data"]; canOpen: boolean; onChange: (product: string, change: number) => void; onClear: () => void }) {
  const units = query.items.reduce((total, item) => total + item.quantity, 0)
  return <section aria-label="Seleção do pedido" className="space-y-3 rounded-lg border bg-muted/20 p-3">
    <details><summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Itens selecionados · {units} un. em {query.items.length} equipamentos</summary><ul className="mt-3 divide-y">{query.items.map(item => {
      const product = data?.items.find(product => product.productId === item.productId)
      return <li key={item.productId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2"><div className="min-w-0 flex-1 basis-40 text-xs [overflow-wrap:anywhere]"><p className="font-medium">{product?.name || "Equipamento fora desta linha"}</p><p className="text-muted-foreground">{product?.sku || item.productId}</p>{product?.available !== true && <p className="text-muted-foreground">Revise a disponibilidade antes de abrir o pedido.</p>}</div><div className="flex items-center gap-2"><Button className="h-9 min-w-9 px-2" variant="outline" aria-label={`Diminuir quantidade de ${product?.name || item.productId}`} onClick={() => onChange(item.productId, -1)}>−</Button><span className="min-w-6 text-center text-xs tabular-nums">{item.quantity}</span><Button className="h-9 min-w-9 px-2" variant="outline" aria-label={`Aumentar quantidade de ${product?.name || item.productId}`} disabled={item.quantity >= 1_000_000} onClick={() => onChange(item.productId, 1)}>+</Button><Button className="h-9 px-2 text-xs" variant="ghost" aria-label={`Remover ${product?.name || item.productId} do pedido`} onClick={() => onChange(item.productId, -item.quantity)}>Remover</Button></div></li>
    })}</ul><Button className="mt-2 h-9 text-xs" variant="outline" onClick={onClear}>Limpar seleção</Button></details>
    <p className="text-xs text-muted-foreground">A seleção fica nesta URL. Confira quantidade, acabamentos e condições no simulador antes de criar o pedido.</p>
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 shadow-sm"><span className="text-xs">{units} un. selecionadas</span>{canOpen ? <Link className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" href={commercialSimulationHref(query)}>Abrir pedido ({units} un.)</Link> : <Button className="min-h-10" disabled>Abrir pedido ({units} un.)</Button>}{!canOpen && <p className="w-full text-xs text-muted-foreground">Confira sua permissão e a disponibilidade de todos os itens nesta linha.</p>}</div>
  </section>
}
