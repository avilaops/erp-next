# Conferência de estoque

[Todas as telas](../../../README.md) · [Estoque](../README.md)

Conferir o fluxo de inventário e contagem disponível na empresa.

**Onde acessar:** `/estoque/inventarios`.

## O que aparece na tela

- Referência e situação do inventário
- Produtos ativos e saldo esperado na abertura da sessão
- Quantidades de contagem e situação

## O que você pode fazer

- Informar uma referência e clicar em Criar sessão
- Abrir a sessão e informar a quantidade contada de cada produto
- Conferir se todos os produtos foram contados
- Aprovar ajustes quando a sessão estiver aberta e completa

## Regras e limites

A sessão começa com o saldo atual dos produtos ativos. Não há seleção de depósito nesta tela; o estoque é consolidado por produto e empresa. A aprovação dos ajustes é uma ação separada da contagem e só fica habilitada quando todos os itens da sessão aberta foram contados.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [inventory-counts](../../../../apps/web/src/features/inventory/inventory-counts.tsx)
