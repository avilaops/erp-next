// Reviewed previews without a persistent operation. Keep operational routes outside this list.
export const demonstrationRoutes = [
  "/aplicativos",
  "/compras/notas-entrada/[id]",
  "/compras/sugestoes",
  "/compras/sugestoes/[id]",
  "/estoque/inventarios",
  "/estoque/inventarios/novo",
  "/estoque/inventarios/[id]",
  "/estoque/inventarios/[id]/contagem",
  "/estoque/lancamentos/[id]",
  "/eventos",
  "/eventos/[id]",
  "/financeiro/conta-digital",
  "/financeiro/contador",
  "/financeiro/controle-caixa",
  "/financeiro/faturamento-agrupado",
  "/financeiro/ficha-financeira",
  "/financeiro/remessas-retornos",
  "/financeiro/tributos",
  "/fiscal/guias",
  "/fiscal/guias/nova",
  "/fiscal/guias/[id]",
  "/logistica/envios",
  "/logistica/envios/nova",
  "/logistica/envios/[id]",
  "/logistica/etiquetas/nova",
  "/logistica/etiquetas/[id]",
  "/logistica/reversa/nova",
  "/logistica/reversa/[id]",
  "/notificacoes",
  "/novidades",
  "/vendas/anuncios",
  "/vendas/anuncios/novo",
  "/vendas/anuncios/[id]",
  "/vendas/anuncios/[id]/editar",
  "/vendas/loja-virtual",
  "/vendas/pdv",
  "/vendas/pdv/fechamento",
  "/vendas/pdv/historico",
] as const

const operationalOverrides = ["/estoque/lancamentos/novo","/preferencias/integracoes/lojas"]

export function isDemonstrationRoute(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/"
  if (operationalOverrides.includes(path)) return false
  const segments = path.split("/")
  return demonstrationRoutes.some(route => {
    const pattern = route.split("/")
    return pattern.length === segments.length && pattern.every((part, index) => part.startsWith("[") || part === segments[index])
  })
}
