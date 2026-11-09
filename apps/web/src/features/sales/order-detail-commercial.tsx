"use client"

import { useEffect, useState } from "react"
import { DataTable } from "@/components/workspace/data-table"
import { ProductThumbnail } from "@/features/catalog/product-thumbnail"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { commercialMoney, commercialQuantity } from "./order-presentation"
import { money, percent, approvalLabels, type Sale, type Director, type SimulationInput } from "./negotiation-types"
import type { Simulation as LegacySimulation } from "@/features/commercial-settings/simulator-model"

type Order = Schema<"OrderSnapshot">
type Quote = { tenantId: string; data: { sale: Sale; input: SimulationInput; version: number } | null; director?: Director | null; approvalStatus?: string }
type Pricing = { tenantId: string; data: { snapshot: LegacySimulation; approved: boolean; needsApproval: boolean } | null }
type Party = Schema<"PartySnapshot">
const approvals: Record<string, string> = { not_required: "Dentro da política", pending: "Aguardando aprovação", approved: "Aprovada", rejected: "Recusada" }

function Fields({ values }: { values: [string, string | undefined | null][] }) {
  const visible = values.filter(([, value]) => value !== undefined && value !== null && value !== "")
  if (!visible.length) return <p className="text-sm text-muted-foreground">Não informado.</p>
  return <dl className="grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(([label, value]) => <div className={`min-w-0 ${["Razão social", "Endereço cadastral", "E-mail"].includes(label) ? "sm:col-span-2 lg:col-span-3" : ""}`} key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</dd></div>)}</dl>
}

export function OrderDetailCommercial({ order, permissions }: { order: Order; permissions: string[] }) {
  const [sources, setSources] = useState<{ key: string; quote?: Quote; pricing?: Pricing; party?: Party; failures: string[] } | null>(null)
  const key = `${order.tenantId}:${order.data.id}:${order.data.revision}`
  const canReadCustomer = permissions.includes("catalog.parties.read")
  const canReadDirector = permissions.includes("sales.approvals.director") && permissions.includes("platform.company.manage")
  useEffect(() => {
    const controller = new AbortController()
    const failures: string[] = []
    async function read<T extends { tenantId: string }>(url: string, label: string): Promise<T | undefined> {
      try {
        const response = await erpFetch(url, { cache: "no-store", signal: controller.signal })
        if (!response.ok) throw Error(label)
        const value = await response.json() as T
        if (value.tenantId !== order.tenantId) throw Error(label)
        return value
      } catch { if (!controller.signal.aborted) failures.push(label); return undefined }
    }
    Promise.all([
      read<Quote>(`/api/erp/commercial/orders/${order.data.id}`, "Condições comerciais"),
      order.pricingOrigin ? read<Pricing>(`/api/erp/orders/${order.data.id}/pricing`, "Simulação preservada") : Promise.resolve(undefined),
      canReadCustomer ? read<Party>(`/api/erp/parties/${order.data.customerId}`, "Cadastro do cliente") : Promise.resolve(undefined)
    ]).then(([quote, pricing, party]) => { if (!controller.signal.aborted) setSources({ key, quote, pricing, party, failures }) })
    return () => controller.abort()
  }, [key, order.tenantId, order.data.id, order.data.customerId, order.pricingOrigin, canReadCustomer])
  const loaded = sources?.key === key ? sources : null
  const quote = loaded?.quote?.data
  const legacySnapshot = loaded?.pricing?.data?.snapshot
  const legacy = legacySnapshot?.tenantId === order.tenantId ? legacySnapshot : undefined
  const sale = quote?.sale
  const customer = loaded?.party?.data
  const address = customer?.addresses?.find(item => item.primary) || customer?.addresses?.[0]
  const contact = customer?.contacts?.find(item => item.primary) || customer?.contacts?.[0]
  const tableTotal = sale?.tableTotalCents ?? legacy?.sale.tableTotalCents
  const discount = sale?.discountCents ?? legacy?.sale.discountCents
  const discountBps = sale?.discountBps ?? legacy?.sale.discountBps
  const total = sale?.totalCents ?? legacy?.sale.invoiceTotalCents
  const entry = sale?.downPaymentCents
  const freight = sale?.freightCents ?? legacy?.sale.freightCents
  const freeDiscount = sale?.freeDiscountBps ?? legacy?.sale.freeDiscountBps
  const director = canReadDirector ? loaded?.quote?.director : null
  const legacyDirector = canReadDirector && legacy?.tenantId === order.tenantId ? legacy.director : undefined
  const amount = (value: number | undefined) => value === undefined ? undefined : money(value)
  const version = quote?.version ?? legacy?.version
  const hasComposition = Boolean(sale || legacy)
  const itemColumns = hasComposition
    ? ["Quantidade", "Tabela sem IPI", "Desconto", "IPI unitário", "Unitário com IPI", "Total"]
    : ["Quantidade", "Unitário", "Total"]
  return <div className="min-w-0 space-y-5 text-sm" aria-label="Condições e composição do pedido">
    {!loaded && <p role="status" className="text-xs text-muted-foreground">Consultando dados comerciais e cadastro do cliente…</p>}
    {loaded?.failures.length ? <p role="status" className="text-xs text-muted-foreground">Não foi possível consultar: {loaded.failures.join(", ")}.</p> : null}
    <section className="min-w-0 space-y-2" aria-label="Itens do pedido">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Equipamentos <span className="text-xs font-normal text-muted-foreground">({order.items.length})</span></h2>{version !== undefined && <span className="rounded-md border bg-muted/40 px-2 py-1 text-xs">Tabela v{version}</span>}</div>
      <div className="max-w-full overflow-x-auto rounded-lg border" role="region" aria-label="Tabela de itens" tabIndex={0}>
        <DataTable className="w-full table-fixed text-left text-sm sm:table-auto print:table-auto">
          <caption className="sr-only">Itens do pedido</caption>
          <thead className="bg-muted/50"><tr><th scope="col" className="p-3">Produto e acabamento</th>{itemColumns.map(label => <th scope="col" className="hidden p-3 text-right sm:table-cell print:table-cell" key={label}>{label}</th>)}</tr></thead>
          <tbody>{order.items.map(item => {
            const negotiated = sale?.items.find(line => line.productId === item.productId)
            const preserved = legacy && order.items.length === 1 && legacy.input.productId === item.productId ? legacy : undefined
            const tableUnit = negotiated?.tableUnitCents ?? preserved?.sale.tableUnitCents
            const itemDiscount = negotiated ? negotiated.tableUnitCents * negotiated.quantity - negotiated.netCents : preserved?.sale.discountCents
            const ipiUnit = negotiated && negotiated.quantity > 0 ? negotiated.ipiCents / negotiated.quantity : preserved ? preserved.sale.unitWithIpiCents - preserved.sale.unitWithoutIpiCents : undefined
            const withIpi = negotiated && negotiated.quantity > 0 ? negotiated.totalCents / negotiated.quantity : preserved?.sale.unitWithIpiCents
            const prices = hasComposition
              ? [amount(tableUnit), amount(itemDiscount), amount(ipiUnit), amount(withIpi) ?? `Não informado · Registrado: ${commercialMoney(item.unitPrice)}`]
              : [commercialMoney(item.unitPrice)]
            const values = [`${commercialQuantity(item.quantity)} ${item.unit}`, ...prices, commercialMoney(item.amount)]
            return <tr className="border-t hover:bg-muted/20" key={item.productId}>
              <td className="min-w-0 p-2 sm:min-w-40 sm:p-3"><div className="flex min-w-0 items-center gap-3"><ProductThumbnail id={item.productId} name={item.name} tenantId={order.tenantId} decorative /><div className="min-w-0"><strong className="break-words font-medium">{item.name}</strong><p className="text-xs text-muted-foreground">{item.sku}</p><p className="break-words text-xs text-muted-foreground">{[item.structureColor && `Estrutura: ${item.structureColor}`, item.plateHolderColor && `Anilheiros: ${item.plateHolderColor}`, item.plateHolderType && `Tipo de anilheiro: ${item.plateHolderType}`, item.upholsteryColor && `Estofado: ${item.upholsteryColor}`].filter(Boolean).join(" · ")}</p></div></div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs sm:hidden print:hidden">
                  {itemColumns.map((label, index) => <div className="min-w-0" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words tabular-nums">{values[index] ?? "Não informado"}</dd></div>)}
                </dl>
              </td>
              {itemColumns.map((label, index) => <td className="hidden p-3 text-right tabular-nums sm:table-cell print:table-cell" key={label}>{values[index] ?? "Não informado"}</td>)}
            </tr>
          })}</tbody>
        </DataTable>
      </div>
      {!hasComposition && <p className="text-xs text-muted-foreground">IPI e descontos não informados neste pedido.</p>}
    </section>
    <section className="space-y-3 border-t pt-4" aria-label="Cliente do pedido"><h2 className="font-semibold">Cliente</h2><Fields values={[
      ["Razão social", order.data.customerName], ["CPF / CNPJ", order.data.customerTaxId?.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5").replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")], ["Inscrição estadual", undefined],
      ["Nome fantasia", customer?.tradeName], ["Contato", contact?.name], ["Telefone", contact?.phone || customer?.phone], ["E-mail", contact?.email || customer?.email],
      ["Endereço cadastral", address ? [address.street, address.number, address.complement, address.district, `${address.city}/${address.state}`, address.postalCode].filter(Boolean).join(" · ") : undefined]
    ]} /></section>
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <section className="min-w-0 space-y-3 border-t pt-4" aria-label="Entrega do pedido"><h2 className="font-semibold">Entrega</h2><Fields values={[
        ["UF de destino negociada", quote?.input.destinationState || legacy?.input.destination], ["Contribuinte de ICMS", quote ? (quote.input.taxpayer ? "Sim" : "Não") : legacy ? (legacy.input.taxpayer ? "Sim" : "Não") : undefined],
        ["Prazo de fabricação", undefined], ["Frete pago pela empresa", amount(freight)], ["Observações de entrega", undefined]
      ]} /></section>
      <section className="min-w-0 space-y-3 border-t pt-4" aria-label="Pagamento do pedido"><h2 className="font-semibold">Pagamento</h2><Fields values={[
        ["Entrada negociada", amount(entry)], ["Saldo após entrada negociada", total !== undefined && entry !== undefined ? money(total - entry) : undefined], ["Forma de pagamento", undefined], ["Vencimento", order.data.dueDate?.split("-").reverse().join("/")]
      ]} />{entry !== undefined && <p className="text-xs text-muted-foreground">Valores negociados. Consulte os recebimentos no financeiro.</p>}</section>
    </div>
    {hasComposition && <section className="space-y-3 border-t pt-4" aria-label="Desconto e aprovação"><h2 className="font-semibold">Desconto e aprovação</h2><Fields values={[
      ["Desconto aplicado", discountBps === undefined ? undefined : percent(discountBps)], ["Desconto em reais", amount(discount)], ["Limite sem aprovação", freeDiscount === undefined ? undefined : percent(freeDiscount)],
      ["Situação da aprovação", quote ? approvals[loaded?.quote?.approvalStatus || ""] || loaded?.quote?.approvalStatus : legacy ? (loaded?.pricing?.data?.approved ? "Aprovada" : loaded?.pricing?.data?.needsApproval ? "Aguardando aprovação" : "Dentro da política") : undefined]
    ]} />{discountBps !== undefined && freeDiscount !== undefined && <div className="space-y-1"><div role="meter" aria-label="Desconto aplicado em relação ao limite livre" aria-valuenow={discountBps / 100} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${percent(discountBps)} aplicado; limite livre ${percent(freeDiscount)}`} className="relative h-2 overflow-hidden rounded-full bg-muted"><span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, Math.max(0, discountBps / 100))}%` }} /><span className="absolute inset-y-0 border-l-2 border-foreground" style={{ left: `${Math.min(100, Math.max(0, freeDiscount / 100))}%` }} /></div><p className="text-xs text-muted-foreground">Desconto {percent(discountBps)} · limite livre {percent(freeDiscount)}</p></div>}
      {sale?.approvalReasons.length ? <ul className="list-inside list-disc text-xs text-muted-foreground">{sale.approvalReasons.map(reason => <li key={reason}>{approvalLabels[reason] || reason}</li>)}</ul> : null}
    </section>}
    <section className="space-y-3 rounded-lg border bg-muted/25 p-4" aria-label="Resumo financeiro do pedido"><h2 className="font-semibold">Resumo do pedido</h2><Fields values={[
      ["Total de tabela sem IPI", amount(tableTotal)], ["Desconto", amount(discount)], ["IPI total", amount(sale?.ipiCents ?? legacy?.sale.ipiCents)], ["Total negociado com IPI", amount(total)],
      ["Total registrado no pedido", commercialMoney(order.data.amount)], ["Entrada negociada", amount(entry)], ["Saldo negociado", total !== undefined && entry !== undefined ? money(total - entry) : undefined], ["Validade da proposta", undefined]
    ]} /></section>
    {(director || legacyDirector) && <section className="space-y-3 border-t pt-4" aria-label="Análise da diretoria"><h2 className="font-semibold">Diretoria · custos, impostos e resultado</h2><Fields values={[
      ["Custo dos equipamentos", amount(director?.equipmentCostCents ?? legacyDirector?.equipmentCostCents)], ["Impostos e taxas", director ? money(director.taxesCents) : undefined], ["DIFAL / FCP", director ? money(director.difalCents) : undefined],
      ["Taxa fixa", amount(director?.fixedFeeCents ?? legacyDirector?.fixedFeeCents)], ["Resultado antes do IR", amount(director?.profitBeforeIncomeTaxCents ?? legacyDirector?.profitBeforeIncomeTaxCents)], ["IRPJ + CSLL", amount(director?.incomeTaxCents ?? legacyDirector?.incomeTaxCents)],
      ["Lucro líquido", amount(director?.netProfitCents ?? legacyDirector?.netProfitCents)], ["Margem líquida", percent((director?.netProfitBps ?? legacyDirector?.netProfitBps)!)], ["Meta de margem", percent((director?.targetBps ?? legacyDirector?.targetMarginBps)!)],
      ["Entrada necessária calculada", amount(director?.requiredDownPaymentCents ?? legacyDirector?.requiredDownPaymentCents)], ["Entrada necessária (%)", percent((director?.requiredDownPaymentBps ?? legacyDirector?.requiredDownPaymentBps)!)], ["Pagamento ao fornecedor", amount(director?.supplierPaymentCents ?? legacyDirector?.supplierPaymentCents)]
    ]} /></section>}
  </div>
}
