"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { states } from "@/features/commercial-settings/commercial-parameters"
import { approvalLabels, inputAmount, money, parseAmount, percent, type Sale } from "./negotiation-types"
import { OrderSection } from "./commercial-order-layout"

export function OrderDiscountFields({ sale, discount, onPercent, onTotal, pending, hasItems, disabled, ownLimit, freeLimit, authority, onAdd }: {
  sale: Sale | null; discount: { kind: string; raw: string }; onPercent: (value: string) => void; onTotal: (value: string) => void;
  pending: boolean; hasItems: boolean; disabled: boolean; ownLimit: number; freeLimit: number; authority?: string; onAdd: () => void
}) {
  const current = sale?.discountBps ?? (discount.kind === "percent" ? parseAmount(discount.raw) : null)
  const profile = { seller: "Vendas", managerTarget: "Gerência · meta", managerProfit: "Gerência · lucro", director: "Diretoria" }[authority || "seller"] || "Vendas"
  return <OrderSection id="order-discount" title="Desconto" detail="Defina o valor antes de parcelar"><fieldset disabled={disabled} className="space-y-4">
    <label className="grid gap-1" htmlFor="order-discount-percent">Desconto (%)</label>
    <div className="order-discount-input"><Input id="order-discount-percent" data-order-field="discount.percent" inputMode="decimal" value={discount.kind === "percent" ? discount.raw : sale ? inputAmount(sale.discountBps) : ""} placeholder="0,00" onChange={event => onPercent(event.target.value)} /><input aria-label="Ajustar desconto percentual" type="range" min="0" max="99.99" step="0.01" value={Math.min(9999, Math.max(0, current || 0)) / 100} onChange={event => onPercent(event.target.value)} /></div>
    <p className="text-sm" aria-live="polite">{sale ? `Desconto atual: ${percent(sale.discountBps)} · redução de ${money(sale.discountCents)}` : hasItems ? "Confira o cálculo para ver o desconto em reais." : "Adicione equipamentos para negociar o valor."}</p>
    <label className="grid gap-1">Valor negociado (com IPI)<Input aria-label="Valor negociado (com IPI)" inputMode="decimal" value={discount.kind === "total" ? discount.raw : sale ? inputAmount(sale.totalCents) : ""} placeholder="Total que o cliente quer pagar" onChange={event => onTotal(event.target.value)} /><span className="text-xs text-muted-foreground">Inclui IPI. O custo de frete por nossa conta não é somado ao valor cobrado.</span></label>
    <div className="order-authority"><meter aria-label="Desconto atual" aria-valuetext={current === null ? "A calcular" : percent(current)} min={0} max={10000} low={freeLimit} high={Math.max(freeLimit, ownLimit)} optimum={0} value={Math.min(10000, Math.max(0, current || 0))} /><p className="text-xs">Faixa livre da tabela: até {percent(freeLimit)}.</p><details className="text-xs"><summary>Perfil e limite de referência</summary><p>{profile} · limite de referência da tabela: {percent(ownLimit)}.</p><p>O cálculo confere desconto, entrada, frete e regras comerciais para indicar a aprovação necessária.</p></details></div>
    <div role="status" className={`order-policy-status ${!sale || sale.approvalReasons.length ? "bg-amber-500/15 text-amber-900 dark:text-amber-200" : "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200"}`}><strong>{!hasItems ? "Adicione equipamentos" : pending ? "Calculando negociação" : !sale ? "Confira as condições" : sale.approvalReasons.length ? "Aprovação necessária" : "Liberado"}</strong><span>{!hasItems ? "Comece pela busca de equipamentos." : sale?.approvalReasons.length ? "Salve o pedido e solicite aprovação no detalhe antes de confirmar." : sale ? "Condições dentro da política comercial." : "Preencha quantidades e valores válidos para calcular."}</span>{sale && sale.approvalReasons.length > 0 && <ul>{sale.approvalReasons.map(reason => <li key={reason}>{approvalLabels[reason] || "Condições sujeitas à aprovação comercial"}</li>)}</ul>}{!hasItems && <Button type="button" variant="outline" onClick={onAdd}>Adicionar equipamento</Button>}</div>
  </fieldset></OrderSection>
}

export function OrderDeliveryDestination({ destination, addressState, originState, manual, onChange, onFollowAddress, taxpayer, taxpayerManual, onTaxpayerChange, disabled }: {
  destination: string; addressState: string; originState: string; manual: boolean; onChange: (value: string) => void; onFollowAddress: () => void;
  taxpayer: string; taxpayerManual: boolean; onTaxpayerChange: (value: string) => void; disabled: boolean
}) {
  return <><h3 tabIndex={-1}>Entrega e condições</h3><fieldset className="order-field-grid" disabled={disabled}>
    <label className="grid gap-1">Estado de entrega<select aria-label="Estado de entrega" data-order-field="delivery.destination" className="h-11 min-w-0 rounded-lg border bg-background px-2" value={destination} onChange={event => onChange(event.target.value)}>{states.map(state => <option key={state}>{state}</option>)}</select><span className="text-xs font-normal text-muted-foreground">{manual ? `Outra UF informada para entrega: ${destination}.` : addressState ? `Origem: UF do endereço do cliente (${addressState}).` : `Padrão da tabela: ${originState}. A UF será atualizada ao preencher o endereço do cliente.`}</span></label>
    <div className="grid content-start gap-1"><p className="text-xs font-medium">Contribuinte do ICMS nesta entrega</p><div className="order-taxpayer" role="group" aria-label="Cliente contribuinte do ICMS">{[["false", "Não"], ["true", "Sim"]].map(([value, label]) => <button type="button" key={value} aria-pressed={taxpayer === value} onClick={() => onTaxpayerChange(value)}>{label}</button>)}</div><p className="text-xs text-muted-foreground">{taxpayerManual ? "Condição informada para esta entrega." : "Segue a inscrição estadual do cliente. ISENTO corresponde a Não."}</p></div>
    {manual && <Button type="button" variant="outline" onClick={onFollowAddress}>Usar UF do endereço</Button>}
  </fieldset></>
}

export function OrderFreightFields({ mode, value, onMode, onChange }: { mode: string; value: string; onMode: (value: string) => void; onChange: (value: string) => void }) {
  return <div className="order-freight-fields grid gap-2"><label className="grid gap-1">Modalidade de entrega<select aria-label="Modalidade de entrega" className="h-11 min-w-0 rounded-lg border bg-background px-2" value={mode} onChange={event => onMode(event.target.value)}><option value="pickup">Retirada</option><option value="customer">Frete pago pelo cliente</option><option value="company">Frete por nossa conta</option></select></label>{mode === "company" && <label className="grid gap-1">Frete por nossa conta (R$)<Input aria-label="Frete por nossa conta (R$)" data-order-field="delivery.freight" inputMode="decimal" value={value} placeholder="0,00" onChange={event => onChange(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">Custo da empresa para o cálculo comercial. Não é acrescentado ao total cobrado do cliente.</span></label>}</div>
}
