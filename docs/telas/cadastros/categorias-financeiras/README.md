# Categorias financeiras

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Organizar categorias de receita e despesa, inclusive com subcategorias.

**Onde acessar:** `/cadastros/categorias-financeiras`.

## O que aparece na tela

- Código e nome
- Natureza: receita ou despesa
- Categoria superior
- Situação e observação

## O que você pode fazer

- Buscar e consultar a hierarquia
- Criar e editar categorias
- Arquivar ou reativar respeitando os vínculos

## Regras e limites

Superior e subcategoria precisam ter a mesma natureza. Criar uma categoria não classifica automaticamente os títulos existentes.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [reference-workspace](../../../../apps/web/src/features/records/reference/reference-workspace.tsx)
