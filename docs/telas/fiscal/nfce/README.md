# NFC-e

[Todas as telas](../../../README.md) · [Fiscal](../README.md)

Consultar e acompanhar os documentos de consumidor do fluxo fiscal.

**Onde acessar:** `/fiscal/nfce`.

## O que aparece na tela

- Documento, ambiente e situação
- Dados e pagamentos do documento

## O que você pode fazer

- Consultar documentos
- Abrir o editor e acompanhar as ações liberadas

## Regras e limites

A venda do PDV e a autorização da NFC-e são distintas. Certificado, configuração de NFC-e e demais exigências do ambiente continuam necessários.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [fiscal-screen](../../../../apps/web/src/features/fiscal/fiscal-screen.tsx)
- [nfe-draft-editor](../../../../apps/web/src/features/fiscal/nfe-draft-editor.tsx)
