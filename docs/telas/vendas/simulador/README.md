# Simulador comercial

[Todas as telas](../../../README.md) · [Vendas](../README.md)

Conferir equipamentos, desconto, entrada e total antes de criar o pedido.

**Onde acessar:** `/vendas/simulador`.

## O que aparece na tela

- Linha e versão publicada
- Equipamentos, quantidades e acabamentos
- UF e condição de contribuinte
- Desconto percentual, desconto em reais ou total desejado
- Frete por conta da empresa e entrada negociada
- Cliente e vencimento para o pedido

## O que você pode fazer

- Adicionar equipamentos e simular
- Conferir resultado e necessidade de aprovação
- Criar o pedido com as condições conferidas

## Regras e limites

Mudar itens ou condições exige simular novamente. A simulação é gerencial e não preenche a tributação da NF-e. Custos e lucro aparecem apenas para a gestão autorizada.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [SIMULADOR-COMERCIAL-2026-11-05](referencias/SIMULADOR-COMERCIAL-2026-11-05.md)
- [commercial-simulator](../../../../apps/web/src/features/sales/commercial-simulator.tsx)
