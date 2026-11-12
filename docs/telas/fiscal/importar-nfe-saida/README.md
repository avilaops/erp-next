# Importação de NF-e de saída

[Todas as telas](../../../README.md) · [Fiscal](../README.md)

Registrar um XML de saída autorizado para consulta no ERP.

**Onde acessar:** `/fiscal/notas-saida/importar` e `/fiscal/notas-saida/importadas/{id}`.

## O que aparece na tela

- Arquivo XML e identificação do documento
- Protocolo e dados importados

## O que você pode fazer

- Selecionar e validar o XML
- Importar e consultar o registro

## Regras e limites

Importar XML não emite outra nota e não equivale a concluir um pedido.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [outgoing-xml-imports](../../../../apps/web/src/features/fiscal/outgoing-xml-imports.tsx)
