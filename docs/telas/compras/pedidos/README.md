# Pedidos de compra

[Todas as telas](../../../README.md) · [Compras](../README.md)

Registrar e acompanhar a compra de produtos de um fornecedor.

**Onde acessar:** `/compras`, `/compras/pedidos`.

## O que aparece na tela

- Fornecedor, produtos, quantidades e valores
- Condições, vencimento e situação

## O que você pode fazer

- Pesquisar e preparar um pedido
- Salvar, conferir e seguir as transições permitidas
- Acompanhar o recebimento vinculado

## Regras e limites

Salvar um pedido de compra não confirma recebimento físico nem quita uma conta.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [CADEIA-COMPRA-PAGAMENTO](referencias/CADEIA-COMPRA-PAGAMENTO.md)
- [COMPRAS-CONTAS-PAGAR-INTERFACE](referencias/COMPRAS-CONTAS-PAGAR-INTERFACE.md)
- [purchase-access](../../../../apps/web/src/features/purchasing/purchase-access.tsx)
