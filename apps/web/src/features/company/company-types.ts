
import type { Schema } from "@/lib/api/types"
export const companyFields = ["legalName", "tradeName", "personType", "taxId", "stateRegistration", "municipalRegistration", "suframa", "cnae", "mainActivity", "taxRegime", "companySize", "activityDescription", "postalCode", "state", "city", "street", "number", "district", "complement", "contactName", "phone", "mobile", "email", "billingEmail", "website"] as const

// Rust omits absent partner and logo fields; other fields have serialized defaults.
export type CompanyData = Required<Omit<Schema<"CompanyData">, "partnerName" | "partnerMobile" | "logoDataUrl">> & Partial<Pick<Schema<"CompanyData">, "partnerName" | "partnerMobile">> & { logoDataUrl?: string | null }

export type CompanySnapshot = Omit<Schema<"CompanyResponse">, "data"> & { data: CompanyData }
export type CompanyProblem = { title?: string; errors?: { field: string; message: string }[] }
export const brazilianStates = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]
