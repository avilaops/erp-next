export type IntegrationStatus = "connected" | "disconnected" | "attention" | "error"

export type Integration = {
  provider: string
  name: string
  category: "Vendas" | "Financeiro" | "Automação" | "Comunicação"
  purpose: string
  status: IntegrationStatus
  account: string
  lastSync: string
  capabilities: string[]
  safeError?: string
}

export const integrations: Integration[] = [
  { provider: "mercado-livre", name: "Mercado Livre", category: "Vendas", purpose: "Pedidos, anúncios e estoque", status: "connected", account: "Loja •••• 4821", lastSync: "Hoje, 10:42", capabilities: ["Importar pedidos", "Sincronizar estoque", "Atualizar anúncios"] },
  { provider: "mercado-pago", name: "Mercado Pago", category: "Financeiro", purpose: "Pagamentos e conciliação", status: "attention", account: "Conta •••• 9472", lastSync: "Hoje, 09:15", capabilities: ["Consultar pagamentos", "Conciliar recebimentos"], safeError: "A autorização precisa ser renovada para retomar a sincronização." },
  { provider: "n8n", name: "n8n", category: "Automação", purpose: "Fluxos e webhooks operacionais", status: "connected", account: "Workspace Avila Ops", lastSync: "Ontem, 18:30", capabilities: ["Disparar webhooks", "Acompanhar execuções"] },
  { provider: "whatsapp", name: "WhatsApp Business", category: "Comunicação", purpose: "Avisos e atendimento", status: "disconnected", account: "Nenhuma conta", lastSync: "Nunca sincronizado", capabilities: ["Enviar notificações", "Receber mensagens"] },
  { provider: "shopify", name: "Shopify", category: "Vendas", purpose: "Catálogo e pedidos da loja", status: "error", account: "Loja •••• ludus", lastSync: "22 out, 14:05", capabilities: ["Importar pedidos", "Sincronizar produtos"], safeError: "A conexão não respondeu. Nenhum token ou payload foi registrado nesta demonstração." },
]

export const integrationStatusLabels: Record<IntegrationStatus, string> = {
  connected: "Conectado",
  disconnected: "Desconectado",
  attention: "Atenção",
  error: "Erro",
}
