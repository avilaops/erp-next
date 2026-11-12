"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { money, type Sale } from "./negotiation-types"
import { orderIssuesBySection, orderSteps, type OrderIssue, type OrderStepId } from "./order-progress"

export function focusOrderSection(step: OrderStepId) {
  const section = document.getElementById(`order-${step}`)
  const heading = section?.querySelector<HTMLElement>("h2,h3") || section
  if (!heading) return
  heading.tabIndex = -1
  heading.focus({ preventScroll: true })
  heading.scrollIntoView({ block: "start", behavior: "instant" })
}

export function OrderSectionNavigation({ issues }: { issues: OrderIssue[] }) {
  return <nav className="order-section-navigation" aria-label="Seções do pedido">{orderSteps.map((step, index) => {
    const count = issues.filter(issue => issue.section === step.id).length
    return <button key={step.id} type="button" onClick={() => focusOrderSection(step.id)}><span aria-hidden="true">{index + 1}.</span> {step.label}{count > 0 && <span className="sr-only">, {count} pendências</span>}</button>
  })}</nav>
}

export function OrderPendingReview({ issues, onFocus, attempted }: { issues: OrderIssue[]; onFocus: (issue: OrderIssue) => void; attempted: boolean }) {
  const groups = orderIssuesBySection(issues)
  return <section className="order-pending-review" aria-label="Pendências do pedido" aria-live={attempted ? "polite" : "off"}>
    <h3>{issues.length ? `${issues.length} pendência${issues.length === 1 ? "" : "s"} para salvar` : "Dados conferidos para salvar"}</h3>
    {groups.length ? <><p>Confira os campos indicados. Salvar valida o pedido antes de gravar.</p>{groups.map(group => <details key={group.id} open={attempted || group.issues.length < 3}><summary>{group.label} · {group.issues.length} pendência{group.issues.length === 1 ? "" : "s"}</summary><ul>{group.issues.map(issue => <li key={issue.field}><button type="button" onClick={() => onFocus(issue)}>{issue.message}</button></li>)}</ul></details>)}</> : <p>Ao salvar, o pedido recebe um número e fica em rascunho para confirmação.</p>}
  </section>
}

export function OrderQuickSummary({ sale, pending, hasItems, issueCount }: { sale: Sale | null; pending: boolean; hasItems: boolean; issueCount: number }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const fullHeight = useRef(0)
  useEffect(() => {
    const viewport = window.visualViewport
    function resize() {
      const height = viewport?.height || window.innerHeight
      const focused = document.activeElement
      const editing = focused instanceof HTMLElement && focused.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]")
      if (!editing) fullHeight.current = height
      if (!fullHeight.current) fullHeight.current = Math.max(window.innerHeight, height)
      setKeyboardOpen(!!editing && fullHeight.current - height > 120)
    }
    const focus = () => requestAnimationFrame(resize)
    resize()
    viewport?.addEventListener("resize", resize)
    window.addEventListener("resize", resize)
    document.addEventListener("focusin", focus)
    document.addEventListener("focusout", focus)
    return () => { viewport?.removeEventListener("resize", resize); window.removeEventListener("resize", resize); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", focus) }
  }, [])
  return <section className="order-quick-summary" aria-label="Resumo rápido do pedido" hidden={keyboardOpen}>
    <div><span>Total do pedido</span><strong aria-live="polite" aria-atomic="true">{pending ? "Calculando…" : sale ? money(sale.totalCents) : hasItems ? "Confira o cálculo" : "Adicione equipamentos"}</strong><small>{issueCount ? `${issueCount} pendências para salvar` : "Pronto para revisar"}</small></div>
    <Button type="button" onClick={() => focusOrderSection("review")}>Revisar pedido</Button>
  </section>
}
