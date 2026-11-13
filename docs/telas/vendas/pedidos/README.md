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
- Aceitar a encomenda com condições completas e gerar as parcelas
- Reservar os produtos quando houver estoque físico disponível
- Concluir a operação conforme as regras e o estoque
- Consultar contratos, preparar NF-e e acompanhar o recebível
- Enviar o documento do pedido por e-mail quando houver configuração e permissão

## Regras e limites

Com as condições completas, o pedido pode seguir **Rascunho → Encomenda aceita → Reservado → Concluído**. O aceite confere as condições comerciais, congela o acordo e gera os títulos da entrada e das parcelas, sem reservar estoque. A reserva posterior confere cliente, produto, unidade e saldo disponível; mantém as parcelas, datas e recebimentos existentes. O caminho direto do rascunho para a reserva continua disponível.

Concluir registra a saída física. No fluxo antigo, sem plano de pagamento, também gera o título único a receber. Recebimentos, estornos e comprovantes são registrados no Financeiro. Pagamento parcial ou integral não registra chegada de produto nem reserva estoque. Cancelar com recebimentos ativos exige estornos explícitos e preserva os documentos originais.

A encomenda aceita pode entrar em produção. A etapa Pronto não cria saldo de máquina acabada: a chegada deve ser registrada no Estoque ou no recebimento de uma Compra. Preparar NF-e e iniciar a conferência física da expedição continuam exigindo pedido reservado ou concluído.

No cadastro do cliente, consultar CNPJ preenche apenas campos vazios e confere a empresa da sessão antes de aplicar os dados. Uma resposta vazia ou temporariamente indisponível admite uma nova tentativa automática da consulta. Se a falha continuar, o formulário mantém os dados digitados e permite preencher manualmente ou consultar novamente.

O envio de e-mail permite conferir destinatário, assunto e mensagem e anexa um PDF com os dados registrados do pedido. Não pode enviar um pedido cancelado. Se o resultado ficar sem confirmação, não faça um novo envio: consulte o histórico e o resultado da mesma solicitação e confira a situação com o provedor de e-mail. Um envio pendente bloqueia novas mensagens para evitar duplicação.

## O que ainda precisa de atenção

Escolha Standard, Olímpico ou Não se aplica no item, sem cor de anilheiro. Estrutura, braços e estofado têm seleções independentes e preservam o histórico ao editar a quantidade. As amostras originais dependem da referência de paleta comprovada no cadastro do produto.

## Referências para manutenção

Guia conferido no código de 13/11/2026. As ações dependem das permissões e da configuração da empresa; a publicação em produção deve ser conferida no registro da entrega. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [PEDIDOS-FINANCEIRO](referencias/PEDIDOS-FINANCEIRO.md)
- [Levantamento: recebimentos, contrato e comprovantes](referencias/RECEBIMENTOS-E-DOCUMENTOS.md) — responsabilidades dos módulos e pontos de verificação.
- [sales-order-numbers](referencias/sales-order-numbers.md)
- [orders](../../../../apps/web/src/features/sales/orders.tsx)
