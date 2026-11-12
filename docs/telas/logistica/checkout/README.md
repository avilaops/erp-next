# Checkout de pedidos

[Todas as telas](../../../README.md) · [Logística](../README.md)

Consultar e acompanhar o checkout logístico dos pedidos.

**Onde acessar:** `/logistica/checkout`.

## O que aparece na tela

- Pedido e situação logística
- Dados da conferência disponíveis

## O que você pode fazer

- Consultar e abrir o checkout
- Executar as ações liberadas para o pedido

## Regras e limites

Checkout logístico não confirma recebimento financeiro nem autorização fiscal.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [logistics-screen](../../../../apps/web/src/features/logistics/logistics-screen.tsx)
- [logistics-details](../../../../apps/web/src/features/logistics/logistics-details.tsx)
