# Custos e linha comercial

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Informar os custos que a gestão usa para preparar a tabela comercial.

**Onde acessar:** `/cadastros/produtos/{id}/custos`.

## O que aparece na tela

- Linha Importada ou Nacional
- Custo de compra ou assessoria
- Crédito tributário
- Embalagem

## O que você pode fazer

- Consultar os custos autorizados
- Salvar uma revisão dos custos
- Voltar ao produto

## Regras e limites

Salvar custos não publica uma tabela nem muda o preço base. Os valores são privados da gestão.

## O que ainda precisa de atenção

Os custos nacionais em aberto permanecem sem preenchimento adicional.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [product-costs](../../../../apps/web/src/features/catalog/product-costs.tsx)
