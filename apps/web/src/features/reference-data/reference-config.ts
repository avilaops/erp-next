
import type { Schema } from "@/lib/api/types"
export const referenceConfigs = {
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
export type ReferenceFields = Omit<Schema<"Reference">, "id" | "revision"> & Record<string, string | number | null>
export type ReferenceRecord = Schema<"Reference"> & Record<string, string | number | null>
export type ReferenceSnapshot = Omit<Schema<"ReferenceSnapshot">, "data"> & { data: ReferenceRecord }
export type ReferenceList = Omit<Schema<"ReferenceList">, "data"> & { data: ReferenceRecord[] }
export const modalities = { pix: "Pix", cash: "Dinheiro", bank_transfer: "Transferência bancária", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", boleto: "Boleto", other: "Outra" }
export const accountTypes = { bank: "Conta bancária", cash: "Caixa interno", internal: "Conta interna" }
