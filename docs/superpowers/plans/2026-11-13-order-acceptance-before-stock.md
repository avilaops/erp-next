# Prestock order acceptance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans or superpowers:subagent-driven-development task by task. Preserve the interfaces and the unchanged stock guards below.

**Goal:** Aceitar uma encomenda com estoque zero, congelar o acordo e originar seus títulos; receber R$ 50.000, R$ 10.000 e R$ 40.000 com os mesmos comprovantes; reservar e concluir somente depois da entrada física real.

**Architecture:** Vendas separa aceitação comercial de reserva física. Financeiro continua proprietário dos mesmos títulos, recebimentos, estornos, contas e comissões; Documentos continua proprietário dos comprovantes. `accepted` não integra nenhuma soma de reserva e não cria saldo físico.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL e Next.js/React existentes; sem dependência, serviço ou livro financeiro novo.

**Spec:** `docs/telas/vendas/pedidos/referencias/RECEBIMENTOS-E-DOCUMENTOS.md`; `artifacts/contract-ludus-20261113/prestock-entry-impact.md`; áudio do cliente citado nesses documentos.

**Base da leitura:** `0507897aa91c814bdaa6edf753fa89c0251866ce`, em 13/11/2026. Este arquivo é planejamento; nenhuma mudança funcional foi realizada para produzi-lo. As referências são à raiz do repositório.

## Global constraints

- Trabalhar somente em `C:/Users/nicol/source/erp-next-main`, sem worktree adicional. Nenhum recebimento, e-mail, assinatura ou estoque real durante testes.
- Novo percurso: `draft → accepted → confirmed → completed`; `accepted` aparece como **Encomenda aceita**. Preservar `draft → confirmed → completed` legado.
- Aceitação exige checkout completo já validado; rascunho legado sem checkout não pode ganhar títulos por esse novo comando. Não criar obrigação financeira mantendo o pedido editável em `draft`.
- `confirmed` continua significando reserva coberta por estoque físico; proibição de saldo negativo e consumo das reservas alheias permanece.
- Valores continuam texto decimal na API e centavos inteiros no Financeiro. Não inferir dinheiro de arquivo, aceite, etapa de OP ou status logístico.
- Reutilizar permissões, tenant, mutex transacional, revisão e idempotência atuais. Nenhum bypass de aprovação comercial, direito financeiro ou tenant.
- Não alterar PDFs assinados, contratos antigos ou comprovantes originais. Não acrescentar bloqueio global de expedição por falta de quitação.
- Implementar o conjunto em uma entrega coerente: não publicar estado `accepted` antes de reserva posterior, cancelamento, consumidores e UI estarem completos.

## Interfaces decididas

| Comando | Origem → destino | Contrato |
|---|---|---|
| Novo `POST /api/v1/orders/{id}/accept` | draft → accepted | Sem campos de negócio no corpo, como confirm; `X-Tenant-Id`, `If-Match`, `Idempotency-Key`; `sales.orders.read/manage`; retorna `OrderSnapshot`, 200 e ETag da nova revisão |
| `POST /api/v1/orders/{id}/confirm` | draft → confirmed **ou** accepted → confirmed | Mantém disponibilidade física; draft usa origem financeira atual; accepted apenas verifica/reutiliza os títulos já existentes |
| `POST /api/v1/orders/{id}/cancel` | draft/accepted/confirmed → cancelled | Mesmo cancelamento anterior à expedição: recebimentos ativos precisam de estorno explícito; reconcilia produção e comissões sem simular devolução de produto acabado |
| `POST /api/v1/orders/{id}/complete` | confirmed → completed | Guarda atual de estoque/fiscal; nunca aceita accepted diretamente; não recria títulos do checkout |

O aceite usa escopo de comando **`order.accept`**, evento **`order.accepted`**, request canônico `{id,revision}`. Não mudar os escopos/requests persistidos de confirm/cancel/complete. Direitos são revalidados antes de retornar replay, conforme o padrão existente.

Criar `apps/api/src/domains/sales/acceptance.rs` com handler público `accept(State<AppState>, Extension<AuthenticatedIdentity>, HeaderMap, Path<Uuid>) -> Result<Response, DomainError>` e helper privado `validate_commercial_acceptance(tx, tenant, &OrderSnapshot) -> Result<(), DomainError>`. Compartilhar esse helper com a confirmação direta de draft, mantendo os validadores existentes.

Em `sales/checkout.rs`, acrescentar `originate_on_acceptance(tx, tenant, order, identity, headers) -> Result<(), DomainError>`; extrair somente a criação comum de títulos usada por esse helper e `confirm`. Distinguir a causa auditada `accepted_order_schedule` da causa antiga `confirmed_order_schedule`, sem duplicar SQL de origem. Ambos os caminhos iniciais recusam títulos preexistentes; **somente** a passagem de accepted para confirmed usa `verify_receivables` em vez de originar.

Entrada sem vencimento ganha a data do **aceite**, em `America/Sao_Paulo`; os demais vencimentos permanecem congelados. Reserva posterior não recalcula parcelas, não altera datas, preço, cliente ou comissão e não reaplica uma nova política comercial retroativamente. Reconfere cliente/produto ativos, unidade e disponibilidade física; aprovação e condições comerciais foram validadas no aceite.

## Inventário exato de consumidores

| Arquivo e ponto atual | Ação planejada |
|---|---|
| `migrations/202610270006_sales_receivables.sql:9` | Migração **nova** `202611130004_sales_order_acceptance.sql`: substituir `sales_orders_status_check` por CHECK com draft/accepted/confirmed/completed/cancelled. Não editar migração aplicada. Confirmar que essa versão ainda está livre ao executar o plano. Não mudar estados de compra, proposta, OP ou títulos por substituição global. |
| `apps/api/src/domains/sales.rs:863` | Ampliar a matriz de confirmação/cancelamento conforme tabela; complete permanece confirmed. Publicar o novo módulo/handler; usar a validação compartilhada; manter todos os guards físicos. |
| `apps/api/src/domains/sales.rs:779`, `:791` | Preservar edição somente de draft e bloqueio de pedido que já tem checkout. Testar que accepted não admite mudança de cliente, itens, valores, datas ou acabamento por nenhum endpoint comercial. |
| `apps/api/src/domains/sales.rs:235`, `:262`; `apps/api/src/domains/inventory.rs:69`, `:237` | **Não incluir accepted** em `reserved()`, `reserved_line()` nem na consulta duplicada da lista de saldos. A saída continua exigindo confirmed e saldo físico suficiente para todas as reservas. |
| `apps/api/src/domains/sales/checkout.rs:296`, `:334`, `:349` | Separar origem de verificação; verificar todos os títulos e parcelas, inclusive pagos/parciais; preservar cancelamento após estornos. Manter unicidades e FKs por empresa/pedido/parcela. |
| `apps/api/src/domains/sales/checkout.rs:261` | `confirmationCreatesReceivables` hoje é constante true: torná-lo false quando já existem títulos e manter true no draft com checkout ainda não originado. Evitar promessa incorreta de “gerar parcelas” no próximo confirm. Sem saldo mutável novo. |
| `apps/api/src/domains/finance.rs:20`, `:253`; `order_finance.rs`; `supporting_documents.rs` | A nova origem não passa pelo recebível legado único. Conclusão reutiliza `verify_receivables` quando há checkout. Projeção e documentos já são genéricos por pedido: acrescentar regressões de accepted, sem livro ou comprovante duplicado. |
| `apps/api/src/domains/sales/negotiation.rs:60`, `:832`; `pricing_orders.rs:230`, `:282`; `sales/settings.rs:161` | Aceite chama os mesmos guards de aprovação, preço, valor mínimo, prazo e contato. Decisões/alterações continuam restritas a draft. `negotiation.rs:421` usa “available” para validade comercial de produto/custo/tabela, não estoque: não relaxar essa verificação para encomenda. |
| `apps/api/src/domains/commissions.rs:338`, `:400`; `migrations/202611010004_commissions.sql:93` | Configuração de comissão permanece draft-only, inclusive trigger. Não acrescentar accepted nessa lista. Cada recebimento/estorno continua chamando os hooks atuais. |
| `apps/api/src/domains/sales/metrics.rs:54`, `:81` | Incluir accepted nos pedidos em aberto e na estimativa de comissão futura; não incluí-lo em concluídos nem em aprovação pendente de draft. `dashboard.rs:92` já inclui todo não cancelado: apenas regressão, sem filtro novo. |
| `apps/api/src/domains/production.rs:316`, `:508` | Incluir accepted nas duas listas de venda ativa, criação e mutação de OP. Preservar `production.read/manage`, `sales.orders.read` na criação e Estoque para consumo/reversão. `production.rs:1` continua verdadeiro: etapa Pronto não credita produto acabado. |
| `apps/api/src/domains/returns.rs:338`, `:420`; `production.rs:102` | Reutilizar `reconcile_unshipped` para accepted, preservando reconciliação fiscal, OP/consumos e comissões. `cancel-completed` continua completed-only. Revalidar direitos de produção/estoque antes de replay de cancelamento quando exigidos. |
| `apps/api/src/domains/logistics_checkout.rs:107`; `logistics_dispatch.rs` | Manter checkout físico em confirmed/completed. Não liberar embalagem por accepted. Postagem manual em `logistics.rs:136`, `:245` é metadado independente e não possui esse guard: não afirmar bloqueio global nem transformá-la em movimento de estoque. |
| `apps/api/src/domains/fiscal/order_source.rs:113`; `fiscal/cte_links_store.rs:243` | Manter origem NF-e e seleção de venda para CT-e em confirmed/completed; não ampliá-las incidentalmente. Receber entrada não deve emitir nota. |
| `apps/api/src/domains/contracts/model.rs:265`; `contracts/mod.rs:434`; `sales/order_email.rs:75`, `:319` | Atualmente recusam cancelled, não exigem confirmed. Garantir aceitação sem reescrever contrato/snapshot assinado nem mudar regras de envio/permissão. Geração nova continua exigindo revisão atual do pedido. |
| `apps/api/src/http/mod.rs`; `http/openapi.rs`; `apps/web/src/server/bff/erp-proxy.ts:87` | Registrar accept em router/OpenAPI e no allowlist exato de POST; manter sessão/origem/tenant/revisão/idempotência. MCP deriva o contrato; não possui allowlist própria de estado do pedido localizada nesta leitura. |
| `apps/web/src/features/sales/orders.tsx:46`, `:315`, `:327` | Rótulo Encomenda aceita; aceitar apenas draft com checkout; accepted mostra reservar/cancelar e acesso ao mesmo Financeiro. Não oferecer editar/concluir/NF-e em accepted. Reutilizar boundary que protege comandos incertos de reload por pais/irmãos. |
| `apps/web/src/features/sales/sales-workspace.tsx:13` | Separar rótulo de accepted por contexto: proposta continua Aceita; pedido deve dizer Encomenda aceita. Listagens/relatórios não podem esconder o novo estado. |
| `apps/web/src/features/production/production-workspace.tsx:179` | Incluir accepted no seletor e explicar “pedido aceito, reservado ou concluído”; não renomear estados da OP. |

Não há flag de backorder nas configurações existentes (`sales/settings.rs:15`, `supply_settings.rs:215`). Não criar “ignorar estoque”. Compras recebe fisicamente por `purchasing::receive` → `inventory::receive_purchase_item`; preservar esse caminho. Produção pode atender a demanda aceita, porém sua conclusão não prova entrada física: usar registro real do Estoque, com direitos e configuração existentes. Se movimentos manuais estiverem desabilitados, não alterar a configuração para fabricar saldo; uma entrada vinculada à OP será fluxo próprio, não efeito implícito deste aceite.

## Review focus

1. Aceite com resposta perdida e recebimento concorrente: replay não duplica títulos, dinheiro ou comissão; UI não perde a chave.
2. Configuração/tabela comercial alterada depois do aceite: o acordo congelado não é reprecificado ao reservar.
3. Produtos compartilhados entre encomendas aceitas e pedidos reservados: accepted não retém físico nem bloqueia consumo permitido dos demais.
4. Cancelamento após entrada e consumo de componentes: não creditar máquina acabada inexistente, não apagar comprovante e não contornar direito revogado.
5. Estado accepted em consultas de proposta, métricas, Fiscal e postagem manual: não confundir aceitação de proposta com reserva ou transporte executado.

## Task 1 — Aceitação comercial transacional

**Files:** criar `sales/acceptance.rs`, `http/sales_acceptance_tests.rs` e a migração nova; modificar `sales.rs`, `sales/checkout.rs`, `http/mod.rs`, `http/openapi.rs`. Caminhos Rust sob `apps/api/src/` e migração sob `migrations/` conforme inventário.

**Interfaces:** novo accept e helper de origem definidos acima; produz `OrderSnapshot` accepted e todos os recebíveis originais. Não produz reserva/movimento/recebimento/OP.

- [x] Escrever `acceptance_zero_stock_freezes_checkout_and_originates_all_titles_once`: produto ativo sem linha de saldo, pedido 100000.00, entrada 50000.00 + saldo 50000.00. POST accept retorna 200/accepted/rev+1; dois títulos somam 100000.00; pagamentos, reserva e movimentos continuam zero; vencimento vazio da entrada usa data local do aceite.
- [x] Escrever `acceptance_rejects_missing_checkout_pending_approval_foreign_or_unmanaged_order`: sem checkout, totais inválidos, aprovação pendente, cliente/produto inválido, unidade alterada, outro tenant, leitor e revisão antiga não criam título/estado/comando.
- [x] Executar `cargo test --locked -p erp-next-api acceptance_ -- --test-threads=1` em banco isolado; observar falha funcional antes da implementação.
- [x] Implementar migração, handler/helper e registro sem relaxar estoque. Mesmo comando retorna resultado preservado; reutilização de chave com outra intenção retorna 409.
- [x] Escrever/executar `acceptance_outbox_failure_rolls_back_order_due_date_titles_audit_and_command`, além de aceitar/confirmar concorrentemente a mesma revisão: somente uma intenção vence; nenhuma duplicação.
- [x] Rodar fmt e testes focados; commit restrito aos arquivos revisados. Sem publicação intermediária.

## Task 2 — Reserva posterior e cancelamento coerentes

**Files:** `sales.rs`, `sales/checkout.rs`; testes novos `http/sales_acceptance_tests.rs` e regressões `http/operations_tests.rs`, `http/sales_checkout_tests.rs`, `http/returns_tests.rs`.

**Interfaces:** confirm recebe accepted e mantém todos os IDs/revisões/pagamentos dos títulos; cancel recebe accepted somente pelo percurso anterior à expedição. Nenhum formato financeiro novo.

- [x] Escrever `acceptance_receives_50000_10000_40000_before_physical_arrival`: registrar 50000.00 no título de entrada e 10000.00 + 40000.00 no saldo, com comprovantes; totais 50000/50000 → 60000/40000 → 100000/0. Nenhuma reserva ou saída, inclusive após quitação. Anexo posterior/snapshot assinado permanecem intactos.
- [x] Escrever `acceptance_reserves_after_real_receipt_without_reoriginating_or_redating`: confirm sem físico retorna 409 preservando aceite, títulos e recebimentos; entrada física real pelo Estoque/Compra permite confirm; IDs/datas/valores/pagamentos permanecem iguais. Repetição não duplica reserva. Complete baixa somente o físico real e não cria terceiro título.
- [x] Escrever `acceptance_reservation_competes_with_other_orders_and_honors_frozen_terms`: duas reservas disputam quantidade insuficiente, sem oversubscription; alteração posterior de política/tabela não muda o acordo aceito; cliente/produto inativos ou unidade incompatível continuam bloqueando operação física.
- [x] Escrever `acceptance_cancellation_requires_explicit_reversal_and_preserves_evidence`: dinheiro ativo impede cancelamento; estorno pelo Financeiro recompõe saldo e efeitos; cancelamento seguinte cancela títulos sem movimento de produto acabado e preserva arquivos. Cancelamento concluído continua exigindo completed.
- [x] Implementar a matriz e a escolha origem/verificação; não alterar `reserved`, consulta de saldos ou `issue_reserved_order`.
- [x] Rodar `cargo test --locked -p erp-next-api acceptance_`, `operations_tests`, `sales_checkout_tests` e `returns_tests` em banco isolado. Commit do percurso completo, ainda sem publicar.

## Task 3 — Consumidores operacionais e financeiros

**Files:** `production.rs`, `sales/metrics.rs`; regressões `http/production_tests.rs`, `http/commercial_table_tests.rs`, `http/commission_tests.rs`, `http/cte_links_tests.rs`, `http/sales_acceptance_tests.rs`. Fiscal/Logística/Financeiro permanecem nos arquivos enumerados, com alterações somente se os testes identificarem necessidade real.

- [x] Escrever `accepted_order_enters_production_without_claiming_finished_stock`: OP pode nascer/mudar de etapa em accepted, consumo exige componentes reais e direitos atuais; Pronto não cria máquina em estoque; cancelamento reverte apenas consumo ativo e respeita replay/direitos revogados.
- [x] Escrever `accepted_order_is_open_in_metrics_and_future_commissions`: inclui exatamente uma vez em aberto e estimativa; comissão real só nasce no recebimento, estorno mantém o comportamento existente; não conta como concluído/aprovação pendente.
- [x] Escrever `accepted_order_does_not_unlock_physical_checkout_nfe_or_cte_sale_options`: guards atuais preservados; não exigir pagamento para expedir pedido que já passou legitimamente pelas condições existentes. Separar postagem manual de saída física nas asserções.
- [x] Escrever regressão de chegada via `purchasing::receive` do mesmo produto aceito: entrada real e reserva posterior; sem emissão, compra ou recebimento físico causado pelo aceite/comprovante.
- [x] Alterar somente as listas/queries marcadas no inventário; executar filtros `production_tests`, `commission_tests`, `cte_links_tests` e `acceptance_`; revisar ausência de substituição global de status. Commit.

## Task 4 — UI, contrato de API e verificação final

**Files:** `apps/web/src/features/sales/orders.tsx`, `apps/web/src/features/sales/sales-workspace.tsx`, `apps/web/src/features/production/production-workspace.tsx`, `apps/web/src/server/bff/erp-proxy.ts`; `apps/web/tests/prestock-acceptance-ui.spec.ts` novo; regeneração de `apps/web/src/lib/api/generated.d.ts` pelo OpenAPI real. Ler `apps/web/AGENTS.md` e guias locais antes de implementar frontend.

- [x] Escrever teste de UI: draft com checkout oferece “Aceitar encomenda e gerar parcelas”; accepted oferece “Reservar estoque disponível” e cancelar, sem editar/concluir/NF-e; antes da chegada pode receber e anexar pelos painéis existentes. Perfil somente Vendas não registra dinheiro; perfil financeiro mantém acesso próprio.
- [x] Testar perda de resposta do aceite e recebimento: repetir mesma intenção/chave; pais/irmãos não apagam estado incerto nem liberam ação concorrente; stale preserva edição e exige recarga explícita. Proposta accepted continua “Aceita”, pedido accepted é “Encomenda aceita”.
- [x] Implementar rota BFF exata `/orders/{uuid}/accept`, controles/rótulos e seletor de Produção. Não duplicar formulário financeiro nem inventar saldo devedor negociado.
- [x] Com diretório de trabalho `apps/web`, executar `npm exec -- playwright test --config playwright.danfe.config.ts tests/order-finance-ui.spec.ts tests/commercial-checkout-ui.spec.ts tests/production-ui.spec.ts tests/orders-list-ui.spec.ts tests/sales-entry-ui.spec.ts tests/new-order-mobile-ui.spec.ts --workers=1`, `npm run lint` e `node node_modules/typescript/lib/tsc.js --noEmit`. Os casos de aceite reutilizam a fixture financeira existente; `ERP_BROWSER_DEV=1` para RED/GREEN local e `ERP_BROWSER_DEV=0` para a verificação final após build.
- [x] Na raiz, executar `cargo fmt --all --check`, `cargo check --locked -p erp-next-api --tests` e suite real `cargo test --locked -p erp-next-api` com PostgreSQL isolado. Exportar OpenAPI pelo produtor Rust real; executar comparator/consumer obrigatórios e `node scripts/contracts/generate-web.mjs artifacts/contracts/candidate.json`, sem fabricar contrato a partir do binário antigo.
- [x] Revisar superfície de rotas com `node scripts/architecture/check.mjs --print-routes`, atualizar política somente após revisão e executar o check. Revisar migração/grants, todos os caminhos de replay e nenhum efeito físico/financeiro implícito.
- [ ] Somente com todos os testes atuais e novos verdes: revisão de branch, PR/CI, integração e Release completos conforme a autorização vigente. Verificação posterior separa capacidades publicadas, lacunas físicas de produção e ICP-Brasil individual; não declarar esses objetivos concluídos por haver aceite ou timestamp de assinatura.

## Self review e execução

Os quatro tasks cobrem origem sem físico, dinheiro, reserva posterior, cancelamento, estados consumidores e interface. As cinco classes de Review Focus possuem testes explícitos nos tasks correspondentes. Os formatos de `OrderFinanceSnapshot`, `PaymentInput` e documentos da entrega atual permanecem a origem compartilhada. Não há plano para estoque negativo, obrigação editável, segundo ledger ou política nova de quitação.

Este planejamento não autoriza executar comandos agora. Na execução, atualizar a referência de base se o PR atual ainda receber correções e confirmar o próximo número de migração. Prioridade corrente continua sendo corrigir eventuais falhas SQLx/CI da entrega de recebimentos já em revisão.

**Registro de execução (13/11/2026):** a autorização posterior do usuário iniciou a implementação. Tasks 1–3 passaram nas suítes reais de CI; o Task 4 está em validação final. O comando Playwright acima foi ajustado à configuração e às fixtures existentes; o compilador TypeScript é chamado pelo caminho instalado porque `npm exec tsc` resolveu um CLI diferente. Conforme a instrução mais recente do usuário, a integração do código continua, mas a ativação de infraestrutura/publicação permanece separada. O ledger registra RED/GREEN, SHAs, desvios e evidências; nenhum teste usa pagamentos, convites, assinaturas ou estoque real.
