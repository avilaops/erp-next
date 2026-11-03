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

- [x] Escrever testes HTTP que exigem autorização antes de carregar a fonte; observar 404→403 esperado no Actions antes da implementação.
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

## Evidência intermediária

O Actions `41675861456`, job `126057197518`, confirmou primeiro a ausência
da rota: GET commercial-links retornou 404 em vez do 403 esperado. Os 243
testes anteriores e sete auxiliares passaram, um Ollama foi ignorado.

No commit `d779b1b`, o job Rust `126063145350` compilou e aprovou 252 testes
da API e sete auxiliares, com um Ollama ignorado. Os nove novos casos cobrem
autorização, precondições, rateio/replay, desfazimento/RLS, alvo/transportadora,
concorrência, rollback, opções e mudança de empresa. O catálogo/contexto local
aprovou 17 testes, com 211 operações API. A formatação foi aplicada do artefato
remoto `13251656522`, ZIP SHA-256
`5e7f52509ba1259b697d246b6ab95e6e1529467ca2569bc70e0a03b11a24e2d4`.

A fixture adicional de transportadora própria passou na inspeção real Node;
a suíte completa do motor aprovou 87 testes. Casos adicionais de transportadora
própria, limite de vínculos ativos e revogação de leitura comercial serão
executados no próximo Actions. Nenhuma ferramenta Rust foi executada localmente.

No commit `ba91b47`, o job `126067549260` confirmou o caso RED de revogação:
254 testes aprovados e uma falha, porque a resposta ainda não ocultava dados
do pedido. Os casos de transportadora própria e limite ativo passaram.
Após a correção, `a9c0d6e` aprovou 255 testes API + sete auxiliares no job
`126071629823`; um Ollama ignorado. Build web e OpenAPI compatível passaram.

O job de navegador `126073730097` confirmou HTTP 404 onde o BFF deveria
retornar 200. A jornada seguinte aguardou `Ver vínculos comerciais` até o
limite externo de 60 s encerrar o processo; os demais casos do monitor não
foram executados nessa rodada. O erro e a espera constam no artefato
`13252139300`. Foram então implementados handlers, fronteira e painel.
Os 12 testes locais de modelos e 17 de catálogo/contexto passaram; arquitetura
atual: 340 rotas, sem erros. UI/BFF ainda dependem da execução remota completa.
