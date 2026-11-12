# Empresa e conta

[Todas as telas](../../../README.md) · [Preferências](../README.md)

Consultar a empresa ativa, manter seus dados e acessar a conta e o plano.

**Onde acessar:** `/preferencias/empresa`, `/preferencias/empresa/dados`, `/preferencias/empresa/conta/plano`, `/preferencias/plano`, `/cadastro/empresa` e `/empresas`.

## O que aparece na tela

- CNPJ, razão social e nome fantasia
- Contatos e endereço
- Dados cadastrais e fiscais disponíveis no formulário
- Dados da conta, plano e limites

## O que você pode fazer

- Selecionar a empresa
- Cadastrar e editar conforme as permissões
- Conferir os dados retornados pela consulta de CNPJ
- Consultar a conta e o plano

## Regras e limites

A empresa ativa define quais registros você consulta. Alterar dados da empresa não reescreve documentos já registrados.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [CADASTRO-AUTONOMO-EMPRESAS](referencias/CADASTRO-AUTONOMO-EMPRESAS.md)
- [COMPANY-ACCOUNT](referencias/COMPANY-ACCOUNT.md)
- [company-preferences](../../../../apps/web/src/features/company/company-preferences.tsx)
