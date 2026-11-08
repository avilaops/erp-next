"use client"

import { bands, money, percent, reasons, type Simulation } from "./simulator-model"

function Facts({ rows }: { rows: [string, string][] }) {
  return <dl className="space-y-3">{rows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-5 gap-y-1 border-b pb-2"><dt className="min-w-0 text-sm text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
}

export function SimulationResult({ value, imported }: { value: Simulation; imported: boolean }) {
  const sale = value.sale
  const director = value.director
  const composition: [string, string][] = director ? [
    ["Valor da venda sem IPI", money(sale.netSaleCents)],
    ["ICMS e diferença de destino", money(-director.icmsCents)],
    ["PIS + COFINS", money(-director.pisCofinsCents)],
    ["Comissão, anúncios e taxas do canal", money(-director.channelCents)],
    ["Perdas, garantia e inadimplência", money(-director.provisionsCents)],
    ["Custo dos equipamentos", money(-director.equipmentCostCents)],
    ["Frete por nossa conta", money(-sale.freightCents)],
    ["Taxa fixa por pedido", money(-director.fixedFeeCents)],
    ...(director.roundingCents ? [["Ajuste de arredondamento", money(-director.roundingCents)] as [string, string]] : []),
    ["Sobra antes do IR", money(director.profitBeforeIncomeTaxCents)],
    ["IRPJ + CSLL", money(-director.incomeTaxCents)],
    ["Lucro líquido", money(director.netProfitCents)],
  ] : []
  return <section aria-label="Resultado da simulação" className="form-section min-w-0 space-y-5">
    <div><h2 className="font-semibold">Resultado</h2><p className="mt-1 break-words text-sm text-muted-foreground">{sale.quantity} un. · {value.product.name} · {value.input.destination} · {value.input.taxpayer ? "Com IE" : "Sem IE"}</p></div>
    <div><p className="text-sm text-muted-foreground">Total da venda, com IPI</p><p className="text-3xl font-semibold tabular-nums">{money(sale.invoiceTotalCents)}</p><p className={sale.band === "at_target" ? "mt-2 font-medium text-primary" : "mt-2 font-medium text-destructive"}>{bands[sale.band]}</p></div>
    <Facts rows={[[`Entrada mínima da política (${percent(sale.minimumDownPaymentBps)})`, money(sale.minimumDownPaymentCents)]]} />
    {sale.needsApproval && <div role="status" className="rounded-lg border border-destructive/40 p-3"><p className="font-medium">Exige aprovação da gestão</p><ul className="mt-1 list-inside list-disc text-sm">{sale.approvalReasons.map(reason => <li key={reason}>{reasons[reason] || reason}</li>)}</ul></div>}
    {director && <p className="text-sm">Lucro líquido de {percent(director.netProfitBps)} ({money(director.netProfitCents)}). Meta: {percent(director.targetMarginBps)}.</p>}
    <details><summary className="cursor-pointer py-2 font-medium text-primary">Ver composição</summary><Facts rows={[
      ["Preço de tabela por unidade, sem IPI", money(sale.tableUnitCents)],
      ["Preço de tabela total, sem IPI", money(sale.tableTotalCents)],
      [`Desconto aplicado (${percent(sale.discountBps)})`, money(-sale.discountCents)],
      ["Valor sem IPI", money(sale.netSaleCents)],
      [`IPI (${percent(sale.ipiBps)})`, money(sale.ipiCents)],
      ["Preço por unidade, com IPI", money(sale.unitWithIpiCents)],
      ["Total da venda", money(sale.invoiceTotalCents)],
    ]} /><p className="mt-3 text-xs text-muted-foreground">Valores arredondados por unidade. O total desejado pode ter diferença de centavos para preservar o mesmo preço em todas as unidades.</p></details>
    {director && <details><summary className="cursor-pointer py-2 font-medium text-primary">Custos e lucro: acesso da gestão</summary><div className="space-y-5 pt-3">
      <Facts rows={[
        ["Preço mínimo na meta por unidade, com IPI", money(director.minimumTargetUnitWithIpiCents)],
        ["Desconto máximo na meta", director.atTargetBps === null ? "Sem desconto viável nesta condição" : percent(director.atTargetBps)],
        ["Desconto máximo sem prejuízo", director.noLossBps === null ? "Preço de tabela já resulta em prejuízo" : percent(director.noLossBps)],
      ]} />
      <h3 className="font-semibold">Entrada necessária</h3><Facts rows={[
        [imported ? "Pagar na China" : "Pagamento ao fornecedor", money(director.supplierPaymentCents)],
        [`Lucro líquido da meta (${percent(director.targetMarginBps)})`, money(director.targetProfitCents)],
        ["Comissão sobre a entrada", money(director.downPaymentCommissionCents)],
        ["Entrada necessária calculada", `${money(director.requiredDownPaymentCents)} · ${percent(director.requiredDownPaymentBps)} da nota`],
      ]} />
      {director.requiredDownPaymentCents > sale.invoiceTotalCents && <p role="status" className="text-destructive">A entrada necessária supera o total da venda. Revise as condições e os custos.</p>}
      <p className="text-xs text-muted-foreground">A entrada calculada cobre fornecedor, lucro da meta e comissão. A entrada da política é o percentual comercial publicado.</p>
      <h3 className="font-semibold">Para onde vai cada real</h3><Facts rows={composition} />
    </div></details>}
  </section>
}
