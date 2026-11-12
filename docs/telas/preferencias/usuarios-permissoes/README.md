# Usuários, papéis e permissões

[Todas as telas](../../../README.md) · [Preferências](../README.md)

Administrar quem pode acessar a empresa e quais operações cada pessoa pode executar.

**Onde acessar:** `/preferencias/usuarios`, `/preferencias/papeis`.

## O que aparece na tela

- Usuário e situação do acesso
- Convite e e-mail
- Papéis e permissões

## O que você pode fazer

- Consultar usuários
- Convidar e gerenciar acessos autorizados
- Criar e editar papéis

## Regras e limites

Funcionário e usuário são cadastros diferentes. A permissão para consultar uma tela não concede automaticamente permissão para gravar ou tomar decisões.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [API-ACESSOS](referencias/API-ACESSOS.md)
- [CONVITES-USUARIOS](referencias/CONVITES-USUARIOS.md)
- [access-workspace](../../../../apps/web/src/features/access/access-workspace.tsx)
