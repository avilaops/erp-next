export const accountSections = {
  socio: "Dados do sócio(a)",
  horarios: "Controle de horários",
  pagamento: "Formas de pagamento",
  extrato: "Extrato da conta",
  armazenamento: "Espaço e armazenamento",
  importacoes: "Importações de pedidos",
  plano: "Alteração de plano",
  cancelamento: "Cancelamento de conta",
} as const
export type AccountSection = keyof typeof accountSections
export const accountHref = (section: AccountSection) => `/preferencias/empresa/conta/${section}`
