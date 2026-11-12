# Loja virtual, anúncios e importação de pedidos

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Identificar as áreas comerciais que ainda não oferecem operação nesta interface.

**Onde acessar:** `/vendas/loja-virtual`, `/vendas/anuncios`, `/vendas/importacao`.

## Regras e limites

Loja virtual, anúncios e importação de pedidos exibem indisponibilidade. Não há envio de anúncio ou importação de vendas por essas telas. A integração por chaves de serviço é configurada em Preferências → Integrações.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [sales-capability-unavailable](../../../../apps/web/src/features/sales/sales-capability-unavailable.tsx)
