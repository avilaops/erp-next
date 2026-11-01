
import type { Schema } from "@/lib/api/types"
export const companyFields = ["legalName", "tradeName", "personType", "taxId", "stateRegistration", "municipalRegistration", "suframa", "cnae", "mainActivity", "taxRegime", "companySize", "activityDescription", "postalCode", "state", "city", "street", "number", "district", "complement", "contactName", "phone", "mobile", "email", "billingEmail", "website"] as const

export type CompanyData = Required<Schema<"CompanyData">>

export type CompanySnapshot = Schema<"CompanyResponse">
export type CompanyProblem = { title?: string; errors?: { field: string; message: string }[] }
export const brazilianStates = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]
