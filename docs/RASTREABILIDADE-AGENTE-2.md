# Rastreabilidade, Agente 2, Comercial e Operação

Este documento separa implementação no branch, validação automatizada, integração
de PR, publicação e validação autenticada. Nenhuma linha abaixo transforma código
presente em aceite de produção sem a evidência correspondente.

| Issue | Implementação | Testes | PR | Pendências |
| --- | --- | --- | --- | --- |
| AVL-432 | Simulador, tabelas nacional/importada, cálculo server-side, aprovação e snapshot de pedido | `apps/web/tests/simulator-ui.spec.ts`; cenários de acesso, edição, aprovação e idempotência | PR #135, aberta no momento do registro | conferir CI apenas pelo responsável após push; validar sessão autenticada e evidências no Linear; regras fiscais por linha permanecem dependentes do contrato fiscal |
| AVL-370 | Compra, confirmação, recebimento parcial/integral, estoque, contas a pagar, pagamento, estorno, revisão e idempotência | `apps/api/src/http/purchase_chain_tests.rs` | PR #12 e dependência PR #9, estado deve ser confirmado no GitHub | executar no GitHub Actions; não há aceite de produção nem operação bancária real |
| AVL-319 | Políticas, protocolo, triagem/transições, fila, responsável ativo, SLA, OS, peças, aprovação, RMA e quarentena | handlers, contrato BFF e painel de triagem; cobertura autenticada ainda não comprovada | não afirmar PR integrada sem consulta atual | anexos, efeitos de troca/devolução/crédito/reembolso, logística física, assinaturas, n8n e métricas conciliadas |
| AVL-17 | Pilotos de pedido, cores/acabamentos e financeiro existentes preservados | testes web de persistência e simulador; simulador cobre 360x640, 390x844, 430x932, 1366x768 e 1440x900 após esta alteração | PR relacionada deve ser confirmada no GitHub | capturas autenticadas antes/depois, teclado/foco/listas longas e validação publicada |
| AVL-369 | Cadastro único de funcionário/vendedor, funções independentes, RLS, RBAC, revisão, idempotência e auditoria | `apps/api/src/http/staff_tests.rs` | PR #9 depende da PR #6, estado deve ser confirmado no GitHub | validação autenticada e evidência de isolamento por empresa |

## Contratos e migrations

- AVL-369: `migrations/202610280003_staff.sql`.
- AVL-370: `migrations/202610280004_purchase_payment_chain.sql`.
- AVL-319: `migrations/202611060101_warranty_service.sql` até
  `migrations/202611060106_warranty_triage_assignment.sql`.
- AVL-432: contratos comerciais, snapshots e aprovação existentes no domínio de
  vendas; a versão da tabela usada permanece no snapshot do pedido.

## Evidência e limites

O código usa PostgreSQL como fonte transacional, RLS, auditoria append-only,
outbox, revisão e `Idempotency-Key` nos comandos sensíveis. Este documento não
declara build local, migration no servidor, CI aprovada, PR integrada, deploy,
produção publicada ou fluxo autenticado validado. Essas afirmações exigem
evidência separada no GitHub, no ambiente autorizado e no Linear.
