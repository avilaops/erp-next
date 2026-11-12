# PDV, fechamento e histórico

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Operar as vendas do PDV e consultar seu fechamento e histórico.

**Onde acessar:** `/vendas/pdv`, `/vendas/pdv/fechamento`, `/vendas/pdv/historico`.

## O que aparece na tela

- Produtos, quantidades e cliente conforme o fluxo
- Pagamentos
- Turno, fechamento e histórico

## O que você pode fazer

- Abrir a operação do PDV
- Conferir venda e pagamentos
- Acompanhar fechamento e vendas anteriores

## Regras e limites

Registrar uma venda no PDV e autorizar uma NFC-e são operações distintas. A emissão depende da configuração fiscal.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [pos-access](../../../../apps/web/src/features/pos/pos-access.tsx)
