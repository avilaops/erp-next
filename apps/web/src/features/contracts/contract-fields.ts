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

export type ContractDocumentField = {
  name: string
  type: string
  required: boolean
  choiceGroup?: string | null
  choiceOption?: string | null
}

export type ContractFieldUnit = {
  kind: "field" | "choice"
  name: string
  fields: ContractDocumentField[]
}

export function contractFieldValue(name: string, defaults: Record<string, string>, values: Record<string, string>) {
  return Object.hasOwn(defaults, name) ? defaults[name] : values[name] || ""
}

export function contractFieldUnits(fields: readonly ContractDocumentField[]): ContractFieldUnit[] {
  const units: ContractFieldUnit[] = []
  const choices = new Map<string, ContractFieldUnit>()
  for (const field of fields) {
    if (!field.choiceGroup || !field.choiceOption) {
      units.push({ kind: "field", name: field.name, fields: [field] })
      continue
    }
    let group = choices.get(field.choiceGroup)
    if (!group) {
      group = { kind: "choice", name: field.choiceGroup, fields: [] }
      choices.set(field.choiceGroup, group)
      units.push(group)
    }
    group.fields.push(field)
  }
  return units
}

export function contractChooseGroup(fields: readonly ContractDocumentField[], selected: string, defaults: Record<string, string>, values: Record<string, string>) {
  if (fields.some(field => Object.hasOwn(defaults, field.name) && defaults[field.name] === "X")) return values
  if (selected && (!fields.some(field => field.name === selected) || Object.hasOwn(defaults, selected))) return values
  const next = { ...values }
  for (const field of fields) {
    if (!Object.hasOwn(defaults, field.name)) next[field.name] = field.name === selected ? "X" : ""
  }
  return next
}

export function contractFieldIsMultiline(name: string) {
  return ["itens", "condicoes", "entrega", "observacoes", "cliente_endereco", "empresa_endereco"].includes(name)
    || /descrição|especificações|observaç|finalidade de uso|individualização|condições especiais|outra destinação|outra condição/iu.test(name)
}
