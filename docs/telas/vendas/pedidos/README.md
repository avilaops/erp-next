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

No cadastro do cliente, consultar CNPJ preenche apenas campos vazios e confere a empresa da sessão antes de aplicar os dados. Uma resposta vazia ou temporariamente indisponível admite uma nova tentativa automática da consulta. Se a falha continuar, o formulário mantém os dados digitados e permite preencher manualmente ou consultar novamente.

O envio de e-mail permite conferir destinatário, assunto e mensagem e anexa um documento HTML com os dados registrados do pedido. Não pode enviar um pedido cancelado. Se o resultado ficar sem confirmação, não faça um novo envio: consulte o histórico e o resultado da mesma solicitação e confira a situação com o provedor de e-mail. Um envio pendente bloqueia novas mensagens para evitar duplicação.

## O que ainda precisa de atenção

Escolha Standard, Olímpico ou Não se aplica no item, sem cor de anilheiro. Estrutura, braços e estofado têm seleções independentes e preservam o histórico ao editar a quantidade. As amostras originais dependem da referência de paleta comprovada no cadastro do produto.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [PEDIDOS-FINANCEIRO](referencias/PEDIDOS-FINANCEIRO.md)
- [sales-order-numbers](referencias/sales-order-numbers.md)
- [orders](../../../../apps/web/src/features/sales/orders.tsx)
