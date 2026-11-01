import PrimeirosPassos from "./primeiros-passos.mdx"
import PedidosVenda from "./pedidos-venda.mdx"
import ComprasEstoque from "./compras-estoque.mdx"
import Financeiro from "./financeiro.mdx"
import Fiscal from "./fiscal.mdx"

export const helpTopics = [
  { id: "primeiros-passos", title: "Primeiros passos", summary: "Configure empresa, usuários e permissões antes de iniciar a operação.", keywords: "empresa usuários permissões contratos modelos assinatura", Content: PrimeirosPassos },
  { id: "pedidos-venda", title: "Pedidos e propostas", summary: "Crie e edite rascunhos antes de reservar estoque e concluir a venda.", keywords: "cliente produtos quantidades preços vencimento confirmar concluir reserva saída", Content: PedidosVenda },
  { id: "compras-estoque", title: "Estoque e compras", summary: "Confira saldos físicos, reservas e movimentos antes de registrar uma operação.", keywords: "fornecedor recebimento parcial integral contas pagar inventário", Content: ComprasEstoque },
  { id: "financeiro", title: "Financeiro", summary: "Consulte títulos e o histórico de recebimentos e pagamentos declarados.", keywords: "receber pagar parcial integral estorno liquidação conciliação bancária", Content: Financeiro },
  { id: "fiscal", title: "Fiscal", summary: "Revise documentos, DANFE e monitor fiscal conforme as capacidades disponíveis.", keywords: "nfe danfe xml emissão certificado manifestação distribuição monitor", Content: Fiscal },
] as const
