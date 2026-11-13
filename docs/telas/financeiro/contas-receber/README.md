# Contas a receber

[Todas as telas](../../../README.md) · [Financeiro](../README.md)

Acompanhar os títulos e registrar os recebimentos autorizados.

**Onde acessar:** `/financeiro/contas-receber`, `/servicos/cobrancas`.

## O que aparece na tela

- Cliente, referência e vencimento
- Valor e situação
- Dados da baixa e do estorno

## O que você pode fazer

- Pesquisar e abrir um título
- Registrar recebimento
- Estornar pelo fluxo disponível

## Regras e limites

Gerar um título não confirma pagamento. Receber e estornar exigem permissão financeira própria.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [Levantamento: recebimentos do pedido e comprovantes](../../vendas/pedidos/referencias/RECEBIMENTOS-E-DOCUMENTOS.md) — reutilização do Financeiro e integrações pendentes.

- [receivables-access](../../../../apps/web/src/features/finance/receivables-access.tsx)
