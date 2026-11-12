# Funcionários

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Manter os dados da equipe e identificar quem atua como vendedor.

**Onde acessar:** `/cadastros/funcionarios`, `/cadastros/vendedores`.

## O que aparece na tela

- Nome, código, cargo e situação
- E-mail e telefone
- Funções de funcionário e vendedor
- Dados pessoais e documentos, em seção própria
- Datas, endereço, contato de emergência e foto

## O que você pode fazer

- Buscar por nome, código ou cargo
- Criar, consultar e editar um cadastro
- Desligar ou reativar pela situação

## Regras e limites

Cadastro de funcionário não cria uma conta de acesso. Os acessos são gerenciados em Usuários e permissões. Os endereços antigos de Vendedores redirecionam para Funcionários.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [FUNCIONARIOS-VENDEDORES](referencias/FUNCIONARIOS-VENDEDORES.md)
- [staff-workspace](../../../../apps/web/src/features/staff/staff-workspace.tsx)
