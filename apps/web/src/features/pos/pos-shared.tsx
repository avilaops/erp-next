"use client"

import Link from "next/link"
import { DataTable } from "@/components/workspace/data-table"
import { Button } from "@/components/ui/button"
import { RequestError } from "@/components/feedback/session-recovery"
import { money, when, methodNames, type Account, type CashSession, type Sale } from "./pos-model"
import "./pos-print.css"

export const controlClass = "h-9 min-w-0 w-full rounded-lg border border-input bg-background px-3 text-sm"
export function AccountSelect({ accounts, value, onChange, label, cashOnly = false, disabled = false, omit }: { accounts: Account[]; value: string; onChange: (value: string) => void; label: string; cashOnly?: boolean; disabled?: boolean; omit?: string }) {
  return <label className="grid min-w-0 gap-1.5 text-xs font-medium">{label}<select aria-label={label} required className={controlClass} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">Selecione uma conta</option>{accounts.filter(account => account.status === "active" && account.id !== omit && (!cashOnly || account.accountType === "cash")).map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
}
export function CashNav({ id }: { id?: string }) {
  return <nav aria-label="Operações do PDV" className="flex flex-wrap gap-x-5 gap-y-2 text-sm print:hidden"><Link className="text-primary underline" href="/vendas/pdv">Frente de caixa</Link><Link className="text-primary underline" href={`/vendas/pdv/fechamento${id ? `?caixa=${id}` : ""}`}>Fechamento do caixa</Link><Link className="text-primary underline" href="/vendas/pdv/historico">Histórico dos caixas</Link></nav>
}
export function Failure({ message, status, retry }: { message: string; status?: number; retry?: () => void }) {
  return <div className="space-y-2" role="alert"><RequestError message={message} status={status} />{retry && <Button variant="outline" onClick={retry}>Consultar novamente</Button>}</div>
}
export function SessionSummary({ session }: { session: CashSession }) {
  return <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">{[["Abertura", session.openingAmount], ["Dinheiro em vendas", session.totals.cash], ["PIX", session.totals.pix], ["Débito", session.totals.debit], ["Crédito", session.totals.credit], ["Suprimentos", session.totals.supplies], ["Sangrias", session.totals.withdrawals], ["Estornos em dinheiro", session.totals.refunds], ["Dinheiro esperado", session.totals.expectedCash], ["Dinheiro contado", session.totals.countedCash], ["Diferença", session.totals.difference]].filter(([, value]) => value != null).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums">{money(value)}</dd></div>)}</dl>
}
export function SaleReceipt({ sale, register, onClose }: { sale: Sale; register?: string; onClose: () => void }) {
  return <section data-pos-receipt className="space-y-4 rounded-lg border bg-muted/20 p-4" aria-label="Comprovante da venda">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Comprovante de venda</h2><p className="text-xs text-muted-foreground">{register} · {when(sale.createdAt)} · {sale.status === "cancelled" ? "Cancelada" : "Concluída"}</p></div><div className="flex gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}>Imprimir comprovante</Button><Button variant="outline" onClick={onClose}>Fechar comprovante</Button></div></div>
    {sale.customerName && <p className="text-sm">Cliente: {sale.customerName}</p>}
    <div className="overflow-x-auto rounded-lg border"><DataTable aria-label="Itens do comprovante"><thead><tr><th>Produto</th><th>Quantidade</th><th className="text-right">Total</th></tr></thead><tbody>{sale.items?.map(item => <tr key={item.productId}><td>{item.name}<span className="block text-xs text-muted-foreground">{item.sku}</span></td><td>{Number(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}</td><td className="whitespace-nowrap text-right">{money(item.total ?? item.amount)}</td></tr>)}</tbody></DataTable></div>
    <div className="space-y-2 text-sm">{sale.payments?.map((payment, index) => <div key={index} className="flex flex-wrap justify-between gap-2"><span>{methodNames[payment.method] || payment.method}</span><span className="tabular-nums">{money(payment.amount)}{Number(payment.change) > 0 && ` · Troco: ${money(payment.change)}`}</span></div>)}</div>
    <p className="text-right text-lg font-semibold tabular-nums">Total: {money(sale.total)}</p><p className="text-xs text-muted-foreground">Comprovante comercial. Documento fiscal disponível no módulo Fiscal.</p>
  </section>
}
