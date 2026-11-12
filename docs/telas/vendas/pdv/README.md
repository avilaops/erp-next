# PDV, fechamento e histórico

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Operar as vendas do PDV e consultar seu fechamento e histórico.

**Onde acessar:** `/vendas/pdv`, `/vendas/pdv/fechamento`, `/vendas/pdv/historico`.

## O que aparece na tela

- Identificação do caixa, conta financeira e fundo de abertura
- Produtos, quantidades, UF e condição de contribuinte
- Cliente, quando informado, e pagamentos
- Suprimentos, sangrias, dinheiro esperado e contado
- Fechamento e histórico

## O que você pode fazer

- Abrir uma sessão de caixa
- Conferir produtos e pagamentos e concluir a venda
- Registrar suprimento ou sangria com motivo e conta de origem ou destino
- Conferir o dinheiro contado e fechar a sessão
- Consultar o histórico e cancelar uma venda permitida

## Regras e limites

O fundo de abertura exige saldo real suficiente na conta caixa. A venda usa os preços comerciais calculados pelo servidor, exige estoque disponível e registra a saída de produtos e os lançamentos financeiros internos. Esses registros não comprovam liquidação em banco ou adquirente.

Fechar a sessão e cancelar uma venda exigem permissões próprias. Diferença no fechamento exige justificativa. O cancelamento só ocorre uma vez e precisa de sessão aberta e saldos suficientes para o estorno. A autorização de NFC-e segue um fluxo fiscal separado.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [pos-access](../../../../apps/web/src/features/pos/pos-access.tsx)
- [Operações e condições do PDV](../../../../apps/api/src/domains/pos.rs).
