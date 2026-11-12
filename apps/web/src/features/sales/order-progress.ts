export type OrderStepId = "equipment" | "customer" | "delivery" | "discount" | "payment" | "review"
export type OrderIssue = { field: string; section: OrderStepId; message: string }
export const orderSteps: { id: OrderStepId; label: string }[] = [
  { id: "equipment", label: "Equipamentos" }, { id: "customer", label: "Cliente" },
  { id: "delivery", label: "Entrega" }, { id: "discount", label: "Desconto" },
  { id: "payment", label: "Pagamento" }, { id: "review", label: "Revisão" },
]

export function orderedOrderIssues(issues: OrderIssue[]): OrderIssue[] {
  const seen = new Set<string>()
  return orderSteps.flatMap(step => issues.filter(issue => {
    if (issue.section !== step.id || seen.has(issue.field)) return false
    seen.add(issue.field)
    return true
  }))
}

export function orderIssuesBySection(issues: OrderIssue[]) {
  const sorted = orderedOrderIssues(issues)
  return orderSteps.map(step => ({ ...step, issues: sorted.filter(issue => issue.section === step.id) })).filter(group => group.issues.length)
}
