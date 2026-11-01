type PreferenceOption = { label: string; description?: string } & (
  | { href: string; unavailable?: never }
  | { href?: never; unavailable: string }
)
export type PreferenceCategory = { id: string; label: string; sections: { title: string; items: PreferenceOption[] }[] }

const unavailable = (label: string, reason = "Esta configuração ainda não está disponível no ERP."): PreferenceOption => ({ label, unavailable: reason })

// Menus da referência visual. Os destinos só apontam para recursos existentes;
// uma tela operacional não substitui uma configuração ainda não implementada.
export const preferenceCategories: PreferenceCategory[] = [
  { id: "empresa", label: "Empresa", sections: [
    { title: "Configurações da empresa", items: [{ label: "Geral", href: "/preferencias/empresa" }] },
    { title: "Tabelas e configurações adicionais", items: [{ label: "Alterar dados da empresa", href: "/preferencias/empresa/dados" }] },
  ] },
  { id: "sistema", label: "Sistema", sections: [
    { title: "Configurações do sistema", items: [{ label: "Interface", href: "/preferencias/sistema", description: "Aparência e quantidade de produtos por página." }] },
    { title: "Tabelas e configurações adicionais", items: [
      unavailable("Consulta de exclusões realizadas"), unavailable("Gerenciador de arquivos"), unavailable("Relatórios customizados"), unavailable("Etiquetas customizadas"),
      { label: "Registro de atividades", href: "/preferencias/seguranca" },
      { label: "Usuários", href: "/preferencias/usuarios" },
      { label: "Papéis e horários", href: "/preferencias/papeis" },
      unavailable("Gerenciador de transições"), unavailable("Campos customizados"),
    ] },
  ] },
  { id: "cadastros", label: "Cadastros", sections: [
    { title: "Configurações de cadastros", items: [unavailable("Configurações de clientes e fornecedores"), unavailable("Configurações de produtos")] },
    { title: "Tabelas e configurações adicionais", items: [
      { label: "Categorias de produtos", href: "/cadastros/categorias-produtos" }, unavailable("Gerenciar tipos de contatos"),
    ] },
  ] },
  { id: "suprimentos", label: "Suprimentos", sections: [
    { title: "Configurações de suprimentos", items: [unavailable("Estoque"), unavailable("Configurações de pedidos de compras")] },
    { title: "Tabelas e configurações adicionais", items: [
      unavailable("Gerenciar grupos de tags"), unavailable("Gerenciar tags"),
      { label: "Depósitos de estoque", href: "/estoque/depositos" }, unavailable("Grupos de produtos"),
    ] },
  ] },
  { id: "vendas", label: "Vendas", sections: [
    { title: "Configurações de vendas", items: [unavailable("Frente de caixa"), unavailable("Propostas comerciais"), { label: "Vendas", href: "/preferencias/vendas" }] },
  ] },
  { id: "notas-fiscais", label: "Notas Fiscais", sections: [
    { title: "Configurações de notas fiscais", items: [
      unavailable("Configurações de NFC-e"), { label: "Configurações de NF-e", href: "/preferencias/fiscal" },
    ] },
    { title: "Tabelas e configurações adicionais", items: [
      unavailable("Consulta de inutilizações de NF-es"), unavailable("Consulta de correções de NF-es", "A consulta consolidada ainda não está disponível. Os eventos existentes são consultados em cada NF-e."), unavailable("Naturezas de operação"),
    ] },
  ] },
  { id: "certificado-digital", label: "Certificado Digital", sections: [
    { title: "Configurações do certificado digital", items: [{ label: "Configurações de certificado digital", href: "/preferencias/certificado-digital" }] },
  ] },
  { id: "financas", label: "Finanças", sections: [
    { title: "Configurações de finanças", items: [
      { label: "Contas a pagar", href: "/preferencias/financeiro", description: "Meio de pagamento sugerido nas baixas manuais." },
      { label: "Contas a receber", href: "/preferencias/financeiro", description: "Meio de pagamento sugerido nas baixas manuais." },
    ] },
    { title: "Conta digital", items: [
      unavailable("Cadastro da conta", "A conta digital ainda não está integrada ao ERP."), unavailable("Gerenciamento de chaves Pix", "O gerenciamento de chaves Pix ainda não está integrado ao ERP."), unavailable("Taxas e prazos da conta digital"),
    ] },
    { title: "Tabelas e configurações adicionais", items: [
      unavailable("Importação de registros financeiros"),
      { label: "Gerenciar categorias de receita e despesa", href: "/cadastros/categorias-financeiras" },
      { label: "Gerenciar contas financeiras", href: "/cadastros/contas-financeiras" },
      { label: "Gerenciar formas de pagamento", href: "/cadastros/formas-pagamento" },
      { label: "Controle de caixa", href: "/financeiro/controle-caixa" }, unavailable("Configurações de integrações de pagamento"),
    ] },
  ] },
  { id: "servicos", label: "Serviços", sections: [
    { title: "Configurações de serviços", items: [
      unavailable("Configurações de NFS-e"), unavailable("Ordens de serviço"),
      { label: "Configurações de contratos e cobranças", href: "/servicos/contratos/modelos", description: "Modelos de contrato. Configuração de cobranças ainda indisponível." },
      unavailable("Configurações de CT-e"),
    ] },
  ] },
  { id: "integracoes", label: "Integrações", sections: [
    { title: "Configurações de integrações", items: [
      { label: "Configurações de lojas virtuais", href: "/preferencias/integracoes/lojas", description: "Chaves de serviço para integração com Ávila Lojas." }, unavailable("SAC Marketplace"),
    ] },
    { title: "Tabelas e configurações adicionais", items: [
      { label: "API para Web Services", href: "/preferencias/integracoes/lojas", description: "Gerenciamento das chaves da integração com Ávila Lojas." },
      { label: "Configurações de integração com lojas virtuais e marketplaces", href: "/preferencias/integracoes" },
      unavailable("Central de atendimento do Mercado Livre"), unavailable("Novidades Mercado Livre"), unavailable("Configurações de balanças comerciais"),
    ] },
  ] },
  { id: "logistica", label: "Logística", sections: [
    { title: "Configurações de logística", items: [unavailable("Configurações de logísticas")] },
    { title: "Tabelas e configurações adicionais", items: [unavailable("Configurações de integrações logísticas")] },
  ] },
  { id: "contabilidade", label: "Contabilidade", sections: [
    { title: "Configurações de contabilidade", items: [{ label: "Espaço do contador", href: "/financeiro/contador" }] },
  ] },
  { id: "importacao", label: "Importações de Dados", sections: [
    { title: "Produtos", items: [
      unavailable("Importar e atualizar produtos"), unavailable("Importar e atualizar vínculo produtos multilojas"), unavailable("Importar e atualizar composições"), unavailable("Importar campos customizados"), unavailable("Importar e atualizar produtos de balança comercial"), unavailable("Importar lista de preços"),
    ] },
    { title: "Contatos", items: [unavailable("Importar e atualizar contatos")] },
    { title: "Suprimentos", items: [unavailable("Importar pedidos de compra"), unavailable("Importar movimentações de estoque em massa"), unavailable("Importar e atualizar fornecedores de produto")] },
    { title: "Fiscal", items: [unavailable("Importar notas fiscais em lote", "A importação em lote ainda não está disponível. A importação individual de XML está em Notas fiscais de entrada.")] },
    { title: "Finanças", items: [unavailable("Importar contas a receber/pagar")] },
    { title: "Vendas", items: [unavailable("Importar vendas")] },
  ] },
  { id: "exportacao", label: "Backup e Exportação de Dados", sections: [
    { title: "Tabelas e configurações adicionais", items: [unavailable("Backup", "A geração e o download de backup ainda não estão disponíveis nesta tela.")] },
  ] },
]
