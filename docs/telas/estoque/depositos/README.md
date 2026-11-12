# Depósitos

[Todas as telas](../../../README.md) · [Estoque](../README.md)

Cadastrar os locais usados no controle de estoque.

**Onde acessar:** `/estoque/depositos`.

## O que aparece na tela

- Código e nome
- Localização, situação e observação

## O que você pode fazer

- Buscar, cadastrar e editar depósitos
- Arquivar ou reativar conforme os vínculos

## Regras e limites

O cadastro guarda a identificação e a localização dos depósitos. Os saldos atuais são consolidados por produto e empresa, sem divisão por depósito; cadastrar um local não cria essa separação.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [reference-workspace](../../../../apps/web/src/features/records/reference/reference-workspace.tsx)
