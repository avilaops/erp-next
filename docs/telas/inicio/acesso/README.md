# Entrar e retomar o acesso

[Todas as telas](../../../README.md) · [Início e navegação](../README.md)

Entrar no ERP e recuperar a continuidade do trabalho após autenticação.

**Onde acessar:** `/entrar`.

## O que aparece na tela

- Dados de acesso e empresa disponível
- Mensagens de acesso e recuperação

## O que você pode fazer

- Entrar pela autenticação configurada
- Retomar o destino permitido
- Selecionar uma empresa quando necessário

## Regras e limites

Acesso à conta e permissão na empresa são verificações distintas. Rascunhos de uma sessão não devem aparecer para outro usuário.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [FRONTEND-AUTH-RETURN](referencias/FRONTEND-AUTH-RETURN.md)
- [auth-page](../../../../apps/web/src/features/access/auth-page.tsx)
