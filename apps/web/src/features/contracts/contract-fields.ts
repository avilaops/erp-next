export const contractFieldLabels: Record<string, string> = {
  empresa_nome: "Nome da empresa",
  empresa_documento: "Documento da empresa",
  empresa_endereco: "Endereço da empresa",
  cliente_nome: "Nome do cliente",
  cliente_documento: "Documento do cliente",
  cliente_email: "E-mail do cliente",
  cliente_endereco: "Endereço do cliente",
  pedido_numero: "Número do pedido",
  pedido_total: "Total do pedido",
  vencimento: "Vencimento",
  itens: "Itens, quantidades e valores",
  condicoes: "Condições comerciais",
  entrega: "Condições e prazo de entrega",
  observacoes: "Observações comerciais",
}

export const contractFieldGroups = [
  { key: "company", title: "Empresa" },
  { key: "customer", title: "Cliente" },
  { key: "order", title: "Pedido e equipamentos" },
  { key: "terms", title: "Pagamento, entrega e observações" },
  { key: "additional", title: "Informações complementares do modelo" },
] as const

export function contractFieldGroup(name: string) {
  if (name.startsWith("empresa_")) return "company"
  if (name.startsWith("cliente_")) return "customer"
  if (["pedido_numero", "pedido_total", "vencimento", "itens"].includes(name)) return "order"
  if (["condicoes", "entrega", "observacoes"].includes(name)) return "terms"
  return "additional"
}
