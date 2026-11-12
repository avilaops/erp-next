# Pedidos de venda

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Registrar a venda, conferir as condições e acompanhar a confirmação e a conclusão do pedido.

**Onde acessar:** `/vendas/pedidos`.

## O que aparece na tela

- Cliente, produtos e quantidades
- Acabamentos e tipo de anilheiro
- Vencimento
- Condições comerciais e aprovação, quando exigida
- Situação do pedido e documentos vinculados

## O que você pode fazer

- Buscar, criar, consultar e editar os pedidos permitidos
- Conferir e confirmar o pedido
- Concluir a operação conforme as regras e o estoque
- Consultar contratos, preparar NF-e e acompanhar o recebível
- Enviar o documento do pedido por e-mail quando houver configuração e permissão

## Regras e limites

Salvar o pedido mantém uma etapa de rascunho antes da confirmação. Confirmar verifica regras e estoque; concluir registra a saída e gera o título a receber. Receber o pagamento é uma ação própria no Financeiro.

O envio de e-mail permite conferir destinatário, assunto e mensagem e anexa um documento HTML com os dados registrados do pedido. Não pode enviar um pedido cancelado. Se o resultado ficar sem confirmação, não faça um novo envio: consulte o histórico e o resultado da mesma solicitação e confira a situação com o provedor de e-mail. Um envio pendente bloqueia novas mensagens para evitar duplicação.

## O que ainda precisa de atenção

Manter a escolha Standard, Olímpico ou Não se aplica no fechamento, sem cor de anilheiro. A paridade das paletas com os catálogos ainda precisa ser concluída.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [PEDIDOS-FINANCEIRO](referencias/PEDIDOS-FINANCEIRO.md)
- [sales-order-numbers](referencias/sales-order-numbers.md)
- [orders](../../../../apps/web/src/features/sales/orders.tsx)
