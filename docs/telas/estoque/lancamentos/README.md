# Lançamentos de estoque

[Todas as telas](../../../README.md) · [Estoque](../README.md)

Consultar movimentações e registrar um lançamento manual autorizado.

**Onde acessar:** `/estoque/lancamentos`.

## O que aparece na tela

- Produto, quantidade e motivo
- Tipo e referência da movimentação

## O que você pode fazer

- Consultar lançamentos
- Abrir Novo lançamento e registrar a movimentação permitida
- Registrar entrada ou saída e conferir o saldo após a confirmação
- Estornar um movimento manual permitido, com motivo

## Regras e limites

Não há seleção de depósito neste lançamento; o saldo é consolidado por produto e empresa. O endereço de detalhe individual ainda informa indisponibilidade. Movimentos originados de pedido não permitem estorno manual nesta tela.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [page](../../../../apps/web/src/app/estoque/lancamentos/page.tsx)
- [page](../../../../apps/web/src/app/estoque/lancamentos/novo/page.tsx)
