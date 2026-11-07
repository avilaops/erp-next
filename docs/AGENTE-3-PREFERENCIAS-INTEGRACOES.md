# Agente 3, Preferências e integrações

## Escopo implementado nesta branch

| Issue | Fluxo | Backend | Permissão | Persistência | Estado de publicação |
|---|---|---|---|---|---|
| AVL-381 | Papéis e permissões | Gestão existente de papéis e permissões | `platform.roles.read/manage` | Existente, com auditoria | Não publicado |
| AVL-378 | Estado Ávila Lojas | `/integrations/service-keys` | `platform.integrations.manage` | `service_api_keys`, RLS | Não publicado |
| AVL-379 | CSV de produtos, prévia e confirmação | `/products/import`, `/products/import/{id}`, `/confirm` | `catalog.products.import` | `product_import_jobs`, RLS, auditoria e outbox | Não publicado |
| AVL-380 | CSV filtrado de produtos | `/products/export` | `catalog.products.export` | Consulta autorizada; sem histórico fictício | Não publicado |
| AVL-372 | Consolidação da navegação | BFF e páginas existentes | Conforme cada domínio | Conforme cada contrato | Não publicado |

## Contrato CSV IMP-01

O formato inicial é CSV UTF-8 com até 2 MiB e 5.000 registros. As colunas obrigatórias são `sku` e `name` ou seus aliases `codigo` e `nome`. Também são aceitos `unit`, `unidade`, `base_price`, `preco`, `price`, `ncm`, `cest` e `status`.

A prévia valida os registros contra o mesmo contrato do cadastro canônico de produtos, marca duplicidades no arquivo e SKUs já existentes na empresa e persiste o resultado. A confirmação exige `Idempotency-Key`, grava somente linhas válidas e não altera estoque, preços, fornecedores, BOM, vínculos multilojas ou documentos fiscais.

## Limites preservados

- O tenant vem da sessão e é aplicado pelo BFF, pela autorização Rust e por RLS.
- Segredos de chaves de serviço nunca são retornados na consulta, somente no momento da criação.
- Exportação retorna apenas produtos autorizados e neutraliza células iniciadas por `=`, `+`, `-` ou `@`.
- Mercado Livre, marketplaces, balanças, SMTP, automações e backup permanecem indisponíveis nesta frente sem contrato operacional próprio.
- Não houve migration, build, deploy ou operação contra produção nesta branch.

## Evidência local

- `cargo check --offline -p erp-next-api` passou após a implementação.
- `cargo test` direcionado foi iniciado, mas havia outro teste do repositório ocupando o lock global do diretório `target`; nenhum teste de produção foi executado.
- Testes unitários do parser CSV e da neutralização de fórmulas estão em `apps/api/src/domains/data_transfer.rs`.
