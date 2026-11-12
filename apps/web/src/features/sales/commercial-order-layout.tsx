"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { money, percent, type PriceItem, type Sale } from "./negotiation-types"
import "./commercial-order.css"

export function OrderSection({ title, detail, children, className = "", id }: { title: string; detail?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`order-section ${className}`} aria-label={title}><div className="order-section-heading"><h2 tabIndex={-1}>{title}</h2>{detail && <div className="order-section-detail">{detail}</div>}</div><div className="order-section-body">{children}</div></section>
}

export function CommercialOrderLayout({ equipment, customer, delivery, payment, discount, totals, save }: { equipment: ReactNode; customer: ReactNode; delivery: ReactNode; payment: ReactNode; discount: ReactNode; totals: ReactNode; save: ReactNode }) {
  return <div className="commercial-order-layout">
    <div className="order-equipment-area">{equipment}</div>
    <div className="order-customer-area"><div id="order-customer">{customer}</div><section id="order-delivery" aria-label="Entrega e condições" className="order-delivery-area">{delivery}</section></div>
    <div className="order-discount-area">{discount}</div>
    <div className="order-payment-area">{payment}</div>
    <aside className="order-negotiation-area" aria-label="Revisão e totais">{totals}<section className="order-save-area" aria-label="Salvar pedido">{save}</section></aside>
  </div>
}

export function OrderEquipmentSearch({ items, selected, disabled, onAdd }: { items: PriceItem[]; selected: string[]; disabled: boolean; onAdd: (id: string) => void }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const normalized = query.trim().toLocaleLowerCase("pt-BR")
  const matches = items.filter(item => item.available !== false && `${item.name} ${item.sku}`.toLocaleLowerCase("pt-BR").includes(normalized)).slice(0, 12)
  function add(id: string) { onAdd(id); setQuery(""); setOpen(false) }
  return <div className="order-equipment-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === "Escape") setOpen(false) }}>
    <label htmlFor="order-equipment-search">Buscar equipamento</label>
    <Input id="order-equipment-search" type="search" autoComplete="off" maxLength={160} placeholder="Nome ou código" value={query} disabled={disabled} aria-expanded={open && !!normalized} aria-controls={open && normalized ? "order-equipment-results" : undefined} onChange={event => { setQuery(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (normalized && matches.length === 1 && (selected.length < 100 || selected.includes(matches[0].productId))) add(matches[0].productId) } }} />
    {open && normalized && <div className="order-equipment-results" id="order-equipment-results" aria-label="Equipamentos encontrados">
      {matches.length ? <ul>{matches.map(item => <li key={item.productId}><Button type="button" variant="ghost" disabled={disabled || selected.length >= 100 && !selected.includes(item.productId)} onClick={() => add(item.productId)}><span><strong>{item.name}</strong><small>{item.sku}{selected.includes(item.productId) ? " · Acrescentar uma unidade" : ""}</small></span><span>{money(item.priceWithIpiCents)}</span></Button></li>)}</ul> : <p role="status">Nenhum equipamento encontrado.</p>}
    </div>}
  </div>
}

export function OrderTotals({ sale, pending, hasItems }: { sale: Sale | null; pending: boolean; hasItems: boolean }) {
  const amount = (value: number | undefined) => value === undefined ? hasItems ? "—" : money(0) : money(value)
  if (!hasItems) return <section className="order-totals" aria-label="Totais do pedido"><p>Adicione equipamentos para calcular.</p></section>
  return <section className="order-section order-totals" aria-label="Totais do pedido" aria-busy={pending}>
    <dl>
      <div><dt>Total de tabela</dt><dd>{amount(sale?.tableTotalCents)}</dd></div>
      <div><dt>Desconto ({percent(sale?.discountBps || 0)})</dt><dd>− {amount(sale?.discountCents)}</dd></div>
      <div className="order-total-strong"><dt>Valor sem IPI</dt><dd>{amount(sale?.netSaleCents)}</dd></div>
      <div><dt>IPI{sale ? ` (${percent(sale.ipiBps)})` : ""}</dt><dd>{amount(sale?.ipiCents)}</dd></div>
      <div className="order-total-final"><dt>Total do pedido</dt><dd>{amount(sale?.totalCents)}</dd></div>
      <div><dt>Entrada{sale && sale.totalCents > 0 ? ` (${percent(Math.round(sale.downPaymentCents * 10000 / sale.totalCents))})` : " (0%)"}</dt><dd>{amount(sale?.downPaymentCents)}</dd></div>
      <div><dt>Saldo</dt><dd>{amount(sale ? sale.totalCents - sale.downPaymentCents : undefined)}</dd></div>
    </dl>
    {sale && <p>Frete por nossa conta: {money(sale.freightCents)}. Custo da empresa, sem acréscimo ao total do pedido.</p>}
    {pending && <p role="status">Calculando negociação…</p>}
    {!pending && hasItems && !sale && <p role="status">Confira os campos para calcular os valores.</p>}
  </section>
}
