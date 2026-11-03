# CT-e Commercial Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular explicitamente transportadora e frete de CT-e conferido a compras/vendas existentes, com histórico e isolamento.

**Architecture:** Vínculos e desfazimentos são registros append-only separados da captura e inspeção. API usa o lock de tenant, revisão agregada e comando idempotente existentes; central apresenta opções paginadas e exige conferência explícita sem efeitos contábeis.

**Tech Stack:** Rust 2024/Axum 0.8/SQLx 0.8/PostgreSQL; Next.js/React/TypeScript existentes.

**Spec:** `docs/superpowers/specs/2026-11-03-vinculos-cte.md`

## Global Constraints

- Testes, formatação, Clippy e compilação Rust somente no GitHub Actions.
- Preservar XML, cursor, inspeção, pedidos, estoque e financeiro.
- `fiscal.cte.link` não entra automaticamente no onboarding.
- Somente homologação; sem merge, deploy ou migração em produção.
- Objetivo integral dos seis tickets preservado; esta etapa não comprova homologação externa.

## Review Focus

- Troca de usuário/permissão no mesmo tenant durante leitura ou comando.
- Duas associações concorrentes que excederiam o frete restante.
- Desfazer/repetir comando sem apagar histórico ou ressuscitar vínculo.
- Cadastro ou pedido muda de situação entre opções e confirmação.
- Zero, centavos, limites e composição de compras/vendas sem arredondamento.

---

### Task 1: API, persistência e invariantes

**Files:**
- Create: `apps/api/src/domains/fiscal/cte_links.rs`, `cte_links_model.rs`, `cte_links_store.rs`.
- Create: `migrations/202611030004_cte_commercial_links.sql`, `deploy/grant-cte-links.sql`.
- Modify: fiscal routes/OpenAPI/onboarding, produção-migrate preparada e catálogo de contratos.
- Test: `apps/api/src/http/cte_links_tests.rs` (primeiro caso RED no módulo de inspeção existente).

**Interfaces:**
- Consumes: inspeção `cte-received-v1`, XML/hash/CNPJ preservados, `authorized`, `revision`, `replay`, `record`, `remember`.
- Produces: GET/POST `documents/{id}/commercial-links`, GET `documents/{id}/commercial-options`, POST `documents/{id}/commercial-links/{linkId}/unlink`, sob `/api/v1/fiscal/cte-distribution`.
- GET links retorna tenant/document/hash, revisão, prestação/alocado em centavos, capacidade por tipo, transportadora e vínculos ativos. Opções recebem kind/offset/limit (25 padrão, máximo 50).
- POST cria `{kind, orderId, carrierPartyId, freightCents, reason}`; `carrierPartyId: null` somente para transportadora igual ao tenant. Desfazer recebe `{reason}`. Ambos exigem UUID e revisão.

- [ ] Escrever testes HTTP que exigem autorização antes de carregar a fonte; observar 404→403 esperado no Actions antes da implementação.
- [ ] Implementar modelos, migration/FKs/RLS/append-only, consulta/opções e comandos atômicos.
- [ ] Exercitar permissões separadas e precondições, alvo/transportadora, zero/limites, replay/conflito, concorrência, desfazimento e rollback; testar ausência de outros efeitos.
- [ ] Registrar OpenAPI, grants preparados e contratos; executar suíte completa Rust/Clippy/formatação somente no Actions.
- [ ] Commit da API com evidência remota aprovada.

### Task 2: Central, BFF e recuperação

**Files:**
- Create: handlers BFF dos quatro caminhos e módulos `cte-links-model.ts`, `cte-links.ts`, `cte-links-panel.tsx`.
- Modify: `cte-distribution-screen.tsx`, `cte-inspection-panel.tsx`, proxy fiscal, contratos/arquitetura.
- Test: modelos Node e `cte-distribution-ui.spec.ts`.

**Interfaces:**
- Consumes: contratos tipados da Task 1, revisão/ETag, capacidades, contexto atual de tenant/usuário/permissões.
- Produces: seleção por nomes/dados do pedido; confirmação com frete e motivo; desfazimento explícito; nenhuma escolha ou rateio automático.

- [ ] Escrever casos de navegador antes dos handlers/painel e observar falha no Actions.
- [ ] Implementar fronteira e fluxo de conferência, mantendo edição após conflito e chave para retry do mesmo payload/contexto.
- [ ] Cobrir erros, novas permissões, sessão tardia, revisão, duplicidade e desfazimento; inspecionar cinco tamanhos.
- [ ] Atualizar catálogo e arquitetura; obter CI completo verde.

### Task 3: Revisão e evidência

- [ ] Revisão independente do conjunto e correção dos achados materiais com regressões.
- [ ] PR draft empilhado no #76, descrição do comportamento final e evidência atual em AVL-111.
- [ ] Separar implementação/CI de publicação e homologação externa; manter escopo restante ativo.
