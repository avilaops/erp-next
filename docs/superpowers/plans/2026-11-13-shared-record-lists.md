# Listagens compartilhadas e ordenação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Use dispatching-parallel-agents only for independent files/domains after shared interfaces are defined.

**Goal:** Padronizar as listagens e ordenar o conjunto completo antes da paginação, com integração e publicação verificadas.

**Architecture:** Componentes próprios e controle compartilhado da ordenação na URL. SQL com allowlists por endpoint e collation pt-BR; comparação tipada somente para coleções completas. Sem biblioteca nova e sem alteração de regras comerciais.

**Tech Stack:** Rust/Axum/sqlx/PostgreSQL18; React/Next16.4.3/TypeScript; Node, Playwright e SQLx.

**Spec:** [Inventário e decisões](../specs/2026-11-13-shared-record-lists.md).

## Global constraints

- Não alterar permissões, dados comerciais, impostos, descontos ou sequência de documentos.
- Preservar q/filtros/offset/limit e parâmetros de navegação não relacionados.
- Nulos no fim, desempate único, texto pt-BR, dinheiro/data/número tipados.
- Nenhuma ordenação local de registros parcialmente carregados.
- Não modificar o checkout original, que contém trabalho independente em andamento.

## Review focus

- Requisições antigas sem sort preservam o padrão, inclusive consumidores auxiliares dos Query compartilhados.
- Filtros e sort sobrevivem a busca, paginação, detalhe/voltar e reset sem apagar seleção comercial.
- SQL não usa campos arbitrários; ordenação por valores exibidos e não aliases textuais de dinheiro/data.
- Estado vazio preserva estrutura e permissões; erros não são apresentados como ausência de cadastro.
- Cabeçalhos e preços continuam legíveis no mobile, rolagem somente no container e teclado utilizável.

## 1. Fundação de ordenação e layout

Files: criar `apps/api/src/domains/list_sort.rs`, migração de collation; expor em domains/mod.rs. Criar `apps/web/src/components/workspace/list-layout.tsx`, `table-sort-model.ts`, `use-table-sort.ts`, aprimorar `data-table.tsx` e workspace-ui.css conforme necessário.

Interfaces backend: `SortField::text(name, expression)` e `SortField::typed(name, expression)` com constantes estáticas; `order_by(sort_by: Option<&str>, sort_order: Option<&str>, fields: &[SortField], default: &str, unique: &str) -> Result<String, DomainError>`. Retorna cláusula ORDER BY completa. Ausência de ambos preserva default; field informado sem direção usa asc; direção sem field, campo ou direção inválidos são recusados. Valores são sempre binds; apenas expressões allowlisted entram na cláusula.

Interfaces frontend: `TableSort { by: string; order: 'asc'|'desc'; explicit: boolean }`; `readTableSort(params, allowed, initial)`, `nextTableSort(state, field)`, `sortTableRows<T>(rows, sort, accessors, key)` com valores string/number/bigint/Date/null e nulos por último. `useTableSort(allowed, initial, prefix?)` retorna `{sort, toggle, query}`; query usa sortBy/sortOrder canônicos quando explícitos, toggle preserva toda URL e offset. `SortableTableHeader` recebe `{field, sort, onSort, children, className}`.

`EntityListPage` recebe `{title, description?, actions?, toolbar?, summary?, footer?, children, className?}`. `SearchToolbar` recebe `{onSubmit, onClear?, canClear?, pending?, children, className?}`, inclui Buscar/Limpar. `FilterField` contém label/children. `StatusBadge` recebe children/tone. `EmptyState` recebe filtered/title?/description?/action?. `ResponsiveTable` recebe label/children/className?. `CurrencyCell` preserva td nativo, children já formatados e nowrap/alinhamento à direita.

- [ ] RED: testes puros do contrato, comparação, toggle e preservação da URL; SQLx de collation com acentos, números e nulos.
- [ ] Implementar a fundação sem migrar domínios ainda.
- [ ] GREEN: Node e testes SQLx focados, tipos/lint dos novos arquivos.

## 2. Cadastros e referências — P1

Files: catalog.rs, parties.rs, staff.rs, reference_data.rs e adapters/constructors dos Query; catalog-workspace/catalog-query, party-workspace, staff-workspace, reference-workspace, registry-query/use-registry-query, BFF erp-proxy.

Keys: products `name,sku,unit,price,status`; parties `legalName,taxId,relationship,contact,status`; staff `code,name,jobTitle,contact,status`; referências `code,name,status,location` (location somente depósitos).

- [ ] RED: 160 produtos em ordem embaralhada; páginas concatenadas ASC/DESC, moeda 2/10/100, acentos, nulos, desempate, filtros, tenant e parâmetros inválidos.
- [ ] Acrescentar sortBy/sortOrder explícitos às structs serde e allowlists BFF. Ordenar antes de LIMIT/OFFSET. Atualizar constructors com defaults.
- [ ] Migrar cabeçalhos/layout/busca/limpar/status/vazio/paginação; manter formulários e privilégios.
- [ ] GREEN: testes de integração e navegador com teclado e quatro larguras.

## 3. Tabelas de preços — P0

Files: sales/commercial-table.tsx, commercial-navigation-model.ts, commercial-settings/price-tables.tsx, price-lists-workspace.tsx e price_lists.rs, BFF.

- [ ] RED: dinheiro grande sem quebra, nomes longos, rolagem contida, ordenação antes do slice14, filtros/destino/itens preservados.
- [ ] Migrar estruturas/valores para os componentes compartilhados. Listas de preços paginadas ordenam no servidor; detalhes completos e publicação/prévia ordenam localmente com accessors tipados.
- [ ] GREEN: modelos + navegador 375/768/1024/1440. Não modificar cálculos, publicação nem permissões.

## 4. Vendas, financeiro, compras e estoque

Files: sales.rs, sales/proposals.rs, sales/opportunities.rs, finance.rs, payables.rs, purchasing.rs, inventory.rs e respectivos componentes orders/proposals/sales-pipeline/sales-workspace/receivables/payables/purchase-list/stock-workspace. Atualizar BFF/contratos.

Keys: orders `number,customerName,status,dueDate,amount`; proposals `customerName,status,version,validUntil,amount`; opportunities `title,companyName,stage,estimatedCents`; receivables `customerName,dueDate,amount,outstandingAmount,status,orderNumber`; payables `supplierName,dueDate,amount,outstandingAmount,status`; purchases `supplierName,status,dueDate,amount`; stock `name,quantity,reserved,available`.

- [ ] RED: ordenação global de agregados monetários, número do pedido, data de vencimento, etapa e status exibido; filtros/páginas e total do funil preservados.
- [ ] Integrar sort SQL; migrar para layout/busca/limpar/status/vazio/moeda. Painel Vendas mantém subseções específicas e apenas reutiliza estrutura de tabelas.
- [ ] GREEN: testes de cada família, regressões de criação/edição/permissões e navegação.

## 5. Demais tabelas compatíveis

Files: pos.rs, fiscal/outgoing_import.rs, point-of-sale/cash-history/cash-closing, outgoing-nfes/outgoing-xml-imports e account-panels (apresentação). Conferir novamente `rg -l 'DataTable|<table' apps/web/src` para qualquer omissão.

- [ ] RED: POS/saída XML ordenados antes do limite; NF-e combina todas as páginas antes de ordenar; movimentos completos usam data/tipo/valor.
- [ ] Integrar componentes e sort conforme o inventário. Faturas do provedor externo não recebem sort local de página parcial: registrar limitação real do contrato.
- [ ] GREEN: testes de integração/fluxo e auditoria final da matriz de cobertura. Registrar cartões sem tabela e tabelas de documentos com sequência fixa.

## 6. Integração e publicação

- [ ] Executar fmt, Clippy, testes apropriados, todos os modelos Node, lint, tipos, build e testes de navegador; inspecionar capturas.
- [ ] Revisão independente de segurança SQL, paginação global e UI/permissões. Resolver problemas importantes.
- [ ] Atualizar documentação por tela e inventário de cobertura; commit/PR com descrição final e evidências.
- [ ] Checks obrigatórios, merge conforme políticas, deploy automático com migração prévia; verificar release/SHA e comportamento publicado sem criar dados de teste em produção.
- [ ] Remover apenas branches temporárias já integradas com segurança; preservar outros trabalhos. Relatar módulos/endpoints/testes/PR/commit/merge/deploy/limitações.
