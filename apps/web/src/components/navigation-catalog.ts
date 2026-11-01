export const desktopMenus = [
  {
    label: "Meu Negócio",
    columns: [
      { title: "Dashboards", items: [{ label: "Dashboard geral", href: "/dashboards" }, { label: "Dashboard de vendas", href: "/dashboards/vendas" }, { label: "Margem por pedido", href: "/dashboards/margem-pedidos" }, { label: "Dashboard de produtos", href: "/dashboards/produtos" }, { label: "Dashboard de clientes", href: "/dashboards/clientes" }, { label: "Curva ABC", href: "/dashboards/curva-abc" }, { label: "Metas", href: "/dashboards/metas" }] },
      { title: "Central de trabalho", items: [{ label: "Eventos", href: "/eventos" }, { label: "Notificações", href: "/notificacoes" }, { label: "Aplicativos", href: "/aplicativos" }, { label: "Assistente", href: "/assistente" }, { label: "Novidades", href: "/novidades" }, { label: "Plano e limites", href: "/preferencias/plano" }] },
    ],
  },
  {
    label: "Cadastros",
    columns: [
      { title: "Operação", items: [{ label: "Produtos", href: "/cadastros/produtos" }, { label: "Clientes e fornecedores", href: "/cadastros/clientes-fornecedores" }, { label: "Vendedores", href: "/cadastros/vendedores" }, { label: "Funcionários", href: "/cadastros/funcionarios" }] },
      { title: "Ferramentas", items: [{ label: "Contas financeiras", href: "/cadastros/contas-financeiras" }, { label: "Categorias financeiras", href: "/cadastros/categorias-financeiras" }, { label: "Categorias de produtos", href: "/cadastros/categorias-produtos" }, { label: "Listas de preços", href: "/cadastros/listas-precos" }, { label: "Formas de pagamento", href: "/cadastros/formas-pagamento" }] },
    ],
  },
  {
    label: "Vendas",
    columns: [
      { title: "Operação", items: [{ label: "Propostas", href: "/vendas/propostas" }, { label: "Pedidos de venda", href: "/vendas/pedidos" }, { label: "PDV", href: "/vendas/pdv" }, { label: "Garantias", href: "/vendas/garantias" }] },
      { title: "Canais e importação", items: [{ label: "Loja virtual", href: "/vendas/loja-virtual" }, { label: "Anúncios", href: "/vendas/anuncios" }, { label: "Importar pedidos", href: "/vendas/importacao" }, { label: "Relatórios de vendas", href: "/vendas/relatorios" }] },
      { title: "Documentos fiscais", items: [{ label: "NF-e", href: "/fiscal/notas-saida" }, { label: "NFC-e", href: "/fiscal/nfce" }, { label: "Notas fiscais de entrada", href: "/compras/notas-entrada" }] },
    ],
  },
  {
    label: "Estoque",
    columns: [
      { title: "Compras", items: [{ label: "Pedidos de compra", href: "/compras/pedidos" }, { label: "Notas fiscais de entrada", href: "/compras/notas-entrada" }, { label: "Fornecedores", href: "/cadastros/clientes-fornecedores" }, { label: "Sugestões de compra", href: "/compras/sugestoes" }, { label: "Check-in de recebimentos", href: "/compras/recebimentos" }] },
      { title: "Estoque", items: [{ label: "Saldos", href: "/estoque/saldos" }, { label: "Lançamentos de estoque", href: "/estoque/lancamentos" }, { label: "Conferência de estoque", href: "/estoque/inventarios" }, { label: "Ordens de produção", href: "/estoque/ordens-producao" }, { label: "Depósitos", href: "/estoque/depositos" }, { label: "Relatórios de estoque", href: "/relatorios/estoque" }] },
    ],
  },
  {
    label: "Financeiro",
    columns: [
      { title: "Operação", items: [{ label: "Contas a receber", href: "/financeiro/contas-receber" }, { label: "Contas a pagar", href: "/financeiro/contas-pagar" }, { label: "Caixa", href: "/financeiro/controle-caixa" }, { label: "Caixas e bancos", href: "/financeiro/caixas-bancos" }] },
      { title: "Gestão", items: [{ label: "Ficha financeira", href: "/financeiro/ficha-financeira" }, { label: "Remessas e retornos", href: "/financeiro/remessas-retornos" }, { label: "Comissões", href: "/financeiro/comissoes" }, { label: "Faturamento agrupado", href: "/financeiro/faturamento-agrupado" }] },
      { title: "Contabilidade e soluções", items: [{ label: "Tributos e guias", href: "/financeiro/tributos" }, { label: "Espaço do contador", href: "/financeiro/contador" }, { label: "Conta Digital", href: "/financeiro/conta-digital" }, { label: "Relatórios financeiros", href: "/financeiro/relatorios" }] },
    ],
  },
  {
    label: "Operações",
    columns: [
      { title: "Logística", items: [{ label: "Objetos de postagem", href: "/logistica/postagens" }, { label: "Logística reversa", href: "/logistica/reversa" }, { label: "Checkout de pedidos", href: "/logistica/checkout" }, { label: "Etiquetas", href: "/logistica/etiquetas" }, { label: "Ávila Envios", href: "/logistica/envios" }] },
      { title: "Serviços", items: [{ label: "Contratos", href: "/servicos/contratos" }, { label: "Ordens de serviço", href: "/servicos/ordens" }, { label: "CT-e", href: "/servicos/cte" }, { label: "Notas de serviço", href: "/servicos/notas" }, { label: "Cobranças", href: "/servicos/cobrancas" }] },
    ],
  },
  {
    label: "Relatórios",
    columns: [
      { title: "Visão executiva", items: [{ label: "Todos os relatórios", href: "/relatorios" }, { label: "Vendas", href: "/relatorios/vendas" }, { label: "Estoque", href: "/relatorios/estoque" }, { label: "Financeiro", href: "/relatorios/financeiro" }] },
      { title: "Operação", items: [{ label: "Serviços", href: "/relatorios/servicos" }, { label: "Auditoria", href: "/relatorios/auditoria" }, { label: "Relatórios de vendas", href: "/vendas/relatorios" }, { label: "Relatórios financeiros", href: "/financeiro/relatorios" }, { label: "Relatórios de serviços", href: "/servicos/relatorios" }] },
    ],
  },
]

export const moduleLinks = [
  ["Histórico importado", "/historico"],
  ["Início", "/"], ["Dashboards", "/dashboards"], ["Cadastros", "/cadastros"],
  ["Vendas", "/vendas"], ["Estoque", "/estoque"], ["Compras", "/compras"],
  ["Financeiro", "/financeiro"], ["Fiscal", "/fiscal"], ["Logística", "/logistica"],
  ["Serviços", "/servicos"], ["Relatórios", "/relatorios"], ["Preferências", "/preferencias"],
] as const

export const preferenceGroups = [
  { label: "Fundação", items: [
    { label: "Empresa", href: "/preferencias/empresa" },
    { label: "Usuários e acessos", href: "/preferencias/usuarios" },
    { label: "Papéis e horários", href: "/preferencias/papeis" },
    { label: "Sistema", href: "/preferencias/sistema" },
    { label: "Segurança e auditoria", href: "/preferencias/seguranca" },
  ] },
  { label: "Operação", items: [
    { label: "Configurações financeiras", href: "/preferencias/financeiro" },
    { label: "Configurações fiscais", href: "/preferencias/fiscal" },
  ] },
  { label: "Conexões e dados", items: [
    { label: "Integrações", href: "/preferencias/integracoes" },
    { label: "Certificado digital", href: "/preferencias/certificado-digital" },
    { label: "Importação de dados", href: "/preferencias/dados/importacao" },
    { label: "Exportação de dados", href: "/preferencias/dados/exportacao" },
  ] },
]

type Destination = { label: string; href: string; category: string; keywords: string }
const candidates = [
  { label: "Visão geral", href: "/", category: "Módulos" },
  ...preferenceGroups.flatMap(group => group.items.map(item => ({ ...item, category: `Preferências / ${group.label}` }))),
  ...moduleLinks.map(([label, href]) => ({ label, href, category: "Módulos" })),
  ...desktopMenus.flatMap(menu => menu.columns.flatMap(column => column.items.map(item => ({ ...item, category: `${menu.label} / ${column.title}` })))),
  { label: "Monitor fiscal", href: "/fiscal/monitor", category: "Fiscal" },
]
const unique = new Map<string, Destination>()
for (const item of candidates) {
  const existing = unique.get(item.href)
  const words = `${item.label} ${item.category}`
  if (existing) existing.keywords += ` ${words}`
  else unique.set(item.href, { ...item, keywords: words })
}
export const navigationDestinations = [...unique.values()]
const quickPaths: string[] = ["/cadastros/produtos","/cadastros/clientes-fornecedores","/vendas/pedidos","/vendas/pdv","/fiscal/notas-saida","/fiscal/nfce","/compras/pedidos","/compras/notas-entrada","/compras/recebimentos","/estoque/inventarios","/financeiro/contas-pagar","/financeiro/contas-receber","/logistica/postagens","/servicos/ordens","/eventos","/notificacoes","/aplicativos","/assistente","/preferencias/usuarios","/preferencias/integracoes","/fiscal/monitor"]
export const quickLinks = navigationDestinations.filter(item => quickPaths.includes(item.href)).map(item => [item.label, item.href] as const)
