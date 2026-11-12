# Contas financeiras

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Cadastrar contas bancárias, caixas e contas internas para os fluxos financeiros.

**Onde acessar:** `/cadastros/contas-financeiras`.

## O que aparece na tela

- Código e nome
- Tipo: banco, caixa ou interna
- Dados bancários quando aplicáveis
- Situação e observação

## O que você pode fazer

- Pesquisar, cadastrar e editar contas
- Arquivar ou reativar

## Regras e limites

Cadastrar uma conta não importa extrato nem cria saldo. Os lançamentos e saldos consultados ficam em Caixas e bancos.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [reference-workspace](../../../../apps/web/src/features/records/reference/reference-workspace.tsx)
