# Categorias e subcategorias de produtos

[Todas as telas](../../../README.md) · [Cadastros](../README.md)

Organizar os produtos em uma hierarquia de categorias.

**Onde acessar:** `/cadastros/categorias-produtos`.

## O que aparece na tela

- Código e nome
- Categoria superior, quando houver
- Ordem de exibição
- Situação e observação

## O que você pode fazer

- Pesquisar e consultar o caminho completo da categoria
- Criar categoria principal ou subcategoria
- Editar a posição na hierarquia
- Selecionar a categoria no cadastro do produto

## Regras e limites

Subcategoria é uma categoria com superior. Uma categoria não pode ser superior de si mesma ou de uma ancestral. Categorias financeiras ficam em outra tela.

## Referências para manutenção

Guia conferido no código de 12/11/2026. As ações dependem das permissões e da configuração da empresa. Relatos técnicos antigos descrevem a etapa em que foram escritos.

- [CADASTROS-AUXILIARES](referencias/CADASTROS-AUXILIARES.md)
- [reference-workspace](../../../../apps/web/src/features/records/reference/reference-workspace.tsx)
- [Hierarquia e navegação dos cadastros](../../../superpowers/specs/2026-11-12-registry-hierarchy-navigation.md).
