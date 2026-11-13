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
  { key: "technical", title: "Especificações técnicas e garantia" },
  { key: "additional", title: "Informações complementares do modelo" },
] as const

export function contractFieldGroup(name: string) {
  if (name.startsWith("empresa_") || name.startsWith("Vendedora —")) return "company"
  if (name.startsWith("cliente_") || name.startsWith("Compradora —") || name.startsWith("Representante da compradora —") || name === "Telefone / WhatsApp da compradora") return "customer"
  if (["pedido_numero", "pedido_total", "vencimento", "itens"].includes(name) || name.startsWith("Produto ") || name.startsWith("Pedido —") || name.startsWith("Disponibilidade ")) return "order"
  if (["condicoes", "entrega", "observacoes"].includes(name) || ["Pagamento —", "Saldo —", "Frete —", "Logística —", "Montagem —", "Instalação —", "Condições especiais"].some(prefix => name.startsWith(prefix))) return "terms"
  if (name.startsWith("Técnica —") || name.startsWith("Garantia —")) return "technical"
  return "additional"
}
