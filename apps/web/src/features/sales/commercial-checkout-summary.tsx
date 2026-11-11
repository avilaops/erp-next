import { money } from "./negotiation-types"
import type { CheckoutSnapshot } from "./commercial-payment-model"

const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "Na confirmação do pedido"

export function CommercialCheckoutSummary({ checkout }: { checkout: CheckoutSnapshot }) {
  const total = checkout.entry.amountCents + checkout.installments.reduce((sum, item) => sum + item.amountCents, 0)
  return <section className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3" aria-label="Plano de pagamento preservado">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Pagamento combinado</h2><strong className="tabular-nums">{money(total)}</strong></div>
    <p className="text-xs text-muted-foreground">Condições preservadas na criação. Consulte os títulos e os recebimentos no financeiro.</p>
    <ol className="divide-y rounded-lg border bg-background">
      {checkout.entry.amountCents > 0 && <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1 p-3"><strong className="text-sm font-medium">Entrada prevista</strong><span className="text-right font-semibold tabular-nums">{money(checkout.entry.amountCents)}</span><span className="break-words text-xs text-muted-foreground">{checkout.entry.paymentMethod?.name || "Forma não informada"}</span><span className="text-right text-xs">{date(checkout.entry.dueOn)}</span></li>}
      {checkout.installments.map(item => <li key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1 p-3"><strong className="text-sm font-medium">Parcela {item.number} de {checkout.installments.length}</strong><span className="text-right font-semibold tabular-nums">{money(item.amountCents)}</span><span className="break-words text-xs text-muted-foreground">{item.paymentMethod.name}</span><span className="text-right text-xs">{date(item.dueOn)}</span></li>)}
    </ol>
    {checkout.paymentNotes && <p className="whitespace-pre-wrap break-words text-sm">{checkout.paymentNotes}</p>}
    {checkout.notes && <div className="space-y-1 border-t pt-2"><h3 className="text-xs font-medium">Observações do pedido</h3><p className="whitespace-pre-wrap break-words text-sm">{checkout.notes}</p></div>}
  </section>
}
