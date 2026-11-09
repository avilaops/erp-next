"use client"

import { money, percent, approvalLabels, type Sale, type Director } from "./negotiation-types"

function Rows({ values }: { values: [string, string][] }) {
  return <dl className="space-y-3">{values.map(([label, value]) => <div key={label} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1"><dt className="min-w-0 break-words text-sm text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
}

export function NegotiationResult({ sale, director }: { sale: Sale; director: Director | null }) {
  const discountLimit = sale.maximumAtTargetDiscountBps ?? director?.maximumAtTargetDiscountBps
  const requiredEntry = sale.requiredDownPaymentCents ?? director?.requiredDownPaymentCents
  return <div className="space-y-5">
    <section className="form-section space-y-4" aria-label="Resultado da simulação">
      <h2 className="font-semibold">Resultado comercial</h2>
      <ul className="space-y-1 text-sm">{sale.items.map(item => <li key={item.productId}>{item.quantity} un. · {item.name} · {item.sku}</li>)}</ul>
      <div><p className="text-sm text-muted-foreground">Total da venda, com IPI</p><p className="break-words text-3xl font-semibold tabular-nums">{money(sale.totalCents)}</p></div>
      {discountLimit !== undefined && requiredEntry !== undefined && <div className="rounded-lg border p-3">
        <Rows values={[["Desconto máximo para atingir a meta", percent(discountLimit)], ["Entrada necessária para este pedido", money(requiredEntry)]]} />
      </div>}
      <Rows values={[[`Entrada comercial mínima (${percent(sale.minimumDownPaymentBps)})`, money(sale.minimumDownPaymentCents)], ["Entrada negociada", money(sale.downPaymentCents)]]} />
      {director && <p className="rounded-lg border p-3">{director.band === "atTarget" ? "Na meta" : director.band === "loss" ? "Com prejuízo" : "Abaixo da meta"} · Lucro líquido {money(director.netProfitCents)} ({percent(director.netProfitBps)}). Meta: {percent(director.targetBps)}.</p>}
      <p role="status">{sale.approvalReasons.length ? "Esta negociação exige aprovação antes da confirmação do pedido." : "Condições dentro da política comercial."}</p>
      {sale.approvalReasons.length > 0 && <ul className="list-inside list-disc text-sm">{sale.approvalReasons.map(reason => <li key={reason}>{approvalLabels[reason] || reason}</li>)}</ul>}
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Ver composição</summary><div className="mt-4 space-y-4">
        {sale.items.map(item => <div key={item.productId}><h3 className="mb-2 text-sm font-medium">{item.name}</h3><Rows values={[["Preço de tabela unitário sem IPI", money(item.tableUnitCents)], ["Quantidade", String(item.quantity)], ["Valor do item sem IPI", money(item.netCents)], ["IPI do item", money(item.ipiCents)], ["Total do item com IPI", money(item.totalCents)]]} /></div>)}
        <Rows values={[["Tabela total sem IPI", money(sale.tableTotalCents)], [`Desconto (${percent(sale.discountBps)})`, money(sale.discountCents)], ["Venda sem IPI", money(sale.netSaleCents)], [`IPI (${percent(sale.ipiBps)})`, money(sale.ipiCents)], ["Total da venda", money(sale.totalCents)]]} />
      </div></details>
    </section>
    {director && <details className="form-section space-y-4"><summary className="cursor-pointer font-semibold">Custos e lucro: gestão autorizada</summary><div className="space-y-5 pt-4">
      <Rows values={[["Valor sem IPI", money(sale.netSaleCents)], [`Impostos e taxas (${percent(director.taxBps)})`, money(director.taxesCents)], [`Diferença de destino e FCP (${percent(director.difalBps)})`, money(director.difalCents)], ["Custo dos equipamentos", money(director.equipmentCostCents)], ["Frete pago pela empresa", money(sale.freightCents)], ["Taxa fixa única por pedido", money(director.fixedFeeCents)], ["Sobra antes do IR", money(director.profitBeforeIncomeTaxCents)], ["IRPJ + CSLL", money(director.incomeTaxCents)], ["Lucro líquido", `${money(director.netProfitCents)} · ${percent(director.netProfitBps)}`], ["Preço mínimo na meta, com IPI: pedido", money(director.minimumAtTargetCents)], ["Desconto máximo na meta", percent(director.maximumAtTargetDiscountBps)], ["Desconto máximo sem prejuízo", percent(director.maximumNoLossDiscountBps)]]} />
      <h3 className="font-semibold">Entrada necessária calculada</h3><p className="text-sm text-muted-foreground">Cobre o fornecedor, o lucro da meta e a comissão sobre a entrada. A condição comercial do pedido é a entrada negociada acima.</p>
      <Rows values={[["Pagamento ao fornecedor / China", money(director.supplierPaymentCents)], ["Lucro líquido da meta", money(director.targetProfitCents)], ["Comissão sobre a entrada", money(director.downPaymentCommissionCents)], ["Entrada necessária", `${money(director.requiredDownPaymentCents)} · ${percent(director.requiredDownPaymentBps)}`]]} />
    </div></details>}
  </div>
}
