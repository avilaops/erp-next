# DANFE de XML autorizado

[Todas as telas](../../../README.md) · [Fiscal](../README.md)

Gerar a representação do documento a partir de XML com protocolo de autorização.

**Onde acessar:** `/fiscal/danfe`.

## O que aparece na tela

- Arquivo XML da NF-e autorizada

## O que você pode fazer

- Selecionar o XML
- Solicitar e baixar o DANFE

## Regras e limites

Gerar DANFE não transmite nem autoriza uma nota. XML sem o protocolo exigido é recusado.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [DANFE-XML-AUTORIZADO](referencias/DANFE-XML-AUTORIZADO.md)
- [danfe-download](../../../../apps/web/src/features/fiscal/danfe-download.tsx)
