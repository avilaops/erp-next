
import type { Schema } from "@/lib/api/types"
export const referenceConfigs = {
  "depositos": {
    title: "Depósitos de estoque", singular: "depósito", endpoint: "warehouses",
    description: "Cadastre e organize os depósitos da empresa. Os saldos atuais são consolidados por produto e empresa, sem divisão por depósito.",
    defaults: { code: "", name: "", status: "active", notes: null, location: null },
  },
  "grupos-produtos": {
    title: "Grupos de produtos", singular: "grupo de produtos", endpoint: "product-groups",
    description: "Grupos de classificação da empresa. O cadastro não altera produtos ou saldos existentes.",
    defaults: { code: "", name: "", status: "active", notes: null },
  },
  "grupos-tags": {
    title: "Grupos de tags", singular: "grupo de tags", endpoint: "tag-groups",
    description: "Organize as tags da empresa em grupos. Para arquivar um grupo, mova ou arquive suas tags ativas.",
    defaults: { code: "", name: "", status: "active", notes: null },
  },
  "tags": {
    title: "Tags", singular: "tag", endpoint: "tags",
    description: "Cadastre tags e organize-as por grupo. Tags ativas só podem pertencer a grupos ativos.",
    defaults: { code: "", name: "", status: "active", notes: null, groupId: null },
  },
  "categorias-produtos": {
    title: "Categorias de produtos", singular: "categoria de produtos", endpoint: "product-categories",
    description: "Hierarquia do catálogo da empresa. O vínculo de produtos às categorias será integrado em uma próxima etapa.",
    defaults: { code: "", name: "", status: "active", notes: null, parentId: null, sortOrder: 0 },
  },
  "categorias-financeiras": {
    title: "Categorias financeiras", singular: "categoria financeira", endpoint: "financial-categories",
    description: "Classificação gerencial da empresa. Receitas e despesas possuem hierarquias separadas.",
    defaults: { code: "", name: "", status: "active", notes: null, parentId: null, direction: "income" },
  },
  "contas-financeiras": {
    title: "Contas financeiras", singular: "conta financeira", endpoint: "financial-accounts",
    description: "Cadastro de contas e caixas. Não consulta saldos nem estabelece conexão bancária.",
    defaults: { code: "", name: "", status: "active", notes: null, accountType: "bank", bank: null, branch: null, accountNumber: null },
  },
  "formas-pagamento": {
    title: "Formas de pagamento", singular: "forma de pagamento", endpoint: "payment-methods",
    description: "Modalidades e prazos de referência. O cadastro não executa pagamentos nem altera recebimentos existentes.",
    defaults: { code: "", name: "", status: "active", notes: null, modality: "pix", settlementDays: 0 },
  },
} as const

export type ReferenceKind = keyof typeof referenceConfigs
export const referencePath = (kind: ReferenceKind) => kind === "depositos" ? "/estoque/depositos" : `/cadastros/${kind}`
export type ReferenceFields = Omit<Schema<"Reference">, "id" | "revision"> & Record<string, string | number | null>
export type ReferenceRecord = Schema<"Reference"> & Record<string, string | number | null>
export type ReferenceSnapshot = Omit<Schema<"ReferenceSnapshot">, "data"> & { data: ReferenceRecord }
export type ReferenceList = Omit<Schema<"ReferenceList">, "data"> & { data: ReferenceRecord[] }
export const modalities = { pix: "Pix", cash: "Dinheiro", bank_transfer: "Transferência bancária", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", boleto: "Boleto", other: "Outra" }
export const accountTypes = { bank: "Conta bancária", cash: "Caixa interno", internal: "Conta interna" }
