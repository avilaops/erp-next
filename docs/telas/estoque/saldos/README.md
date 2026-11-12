# Estoque e saldos

[Todas as telas](../../../README.md) · [Estoque](../README.md)

Consultar o estoque dos produtos da empresa.

**Onde acessar:** `/estoque`, `/estoque/saldos`.

## O que aparece na tela

- Produto e filtros de consulta
- Saldo e reservas disponíveis na consulta

## O que você pode fazer

- Buscar e consultar saldos
- Acessar os lançamentos relacionados

## Regras e limites

Os saldos atuais são consolidados por produto e empresa, sem divisão por depósito. Consulta de saldo não movimenta estoque. A reserva de pedido e a saída são etapas distintas.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [ESTOQUE-PERSISTENTE](referencias/ESTOQUE-PERSISTENTE.md)
- [stock-access](../../../../apps/web/src/features/inventory/stock-access.tsx)
