# Publicação revisada do catálogo Ludus

Os perfis públicos são separados dos dados comerciais internos. Preços e dados fiscais permanecem no ERP. Cada perfil pertence a uma empresa, mantém revisão com If-Match e referencia uma variante já registrada da imagem do mesmo produto.

A prévia retorna um hash dos dados. A publicação exige esse hash e uma chave de idempotência, persiste a versão antes do envio e repete exatamente essa versão em caso de falha. O Worker rejeita sequências antigas e mantém originais privados.

Configuração exclusiva do servidor: `CATALOG_MEDIA_ORIGIN=https://ludusequipamentos.com`, `CATALOG_MEDIA_TENANT` e `CATALOG_MEDIA_TOKEN`. O segredo também é configurado no Worker como `PUBLISH_TOKEN`; não pode aparecer no navegador, Git ou logs.

## Pendências antes de produção

- Aplicar migração e permissões após aprovação dos testes de integração.
- Importar perfis revisados dos 157 produtos, sem alterar preços ou cadastros fiscais.
- Implantar o Worker, configurar integração e conferir uma publicação real.
- Validar galeria autenticada e site no navegador.
- Implementar importação de novas versões de imagem e adaptação da exportação ao avx-tools antes de anunciar essas capacidades como completas.

## Auditoria de cores

Consulta autenticada às duas páginas de `/api/erp/products`, em 2026-11-04, confirmou 160 produtos no tenant Ludus, incluindo 66 Core. Todos retornaram listas vazias de `structureColors` e `upholsteryColors`. Nenhuma cor deve ser inferida das fotos recoloridas. A lista comercial por estrutura/estofado e por linha aguarda informação do solicitante.

O fluxo de preparação fiscal em `domains/fiscal/order_source.rs` não transporta as cores do pedido. O suporte de cores em propostas, pedidos e contratos não prova suporte na NF-e.
