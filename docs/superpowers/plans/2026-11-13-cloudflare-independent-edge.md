# Cloudflare independent edge implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task.

**Goal:** Publicar uma camada HTTP e de arquivos estáticos que não dependa da VPS bloqueada, com armazenamento privado separado e status honesto da aplicação.

**Architecture:** Worker de entrada com binding R2 limitado aos assets públicos; APIs e páginas privadas usam um futuro binding APP ou retornam 503. PostgreSQL, autenticação e runtimes completos ficam na etapa de recuperação/migração, sem contratação automática.

**Tech Stack:** Worker ES module JavaScript, Fetch/R2/Cache APIs, testes node:test existentes, Cloudflare REST via conector, sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-13-cloudflare-independent-edge.md`

## Global Constraints

- Somente `C:/Users/nicol/source/erp-next-main`; branch `feat/cloudflare-erp-resilience-20261113` baseada em main `fa7e152`.
- Não modificar negócio, autenticação, PostgreSQL, fiscal, portal ou feature de encomenda pausada.
- Bucket vazio e página 503 não significam ERP recuperado nem backup concluído.
- Nenhum plano pago ou dado de negócio durante a entrega.
- Preservar arquivos não rastreados do usuário; commits somente de paths próprios.

## Review Focus

- Nenhum caminho ou resposta pode expor backups/documentos privados.
- API, callbacks de autenticação e POST financeiros não podem ser cacheados ou repetidos.
- Cache e assets não podem se misturar entre versões do build.
- Saúde da edge não deve mascarar indisponibilidade da aplicação.
- Observabilidade não pode persistir query strings de OAuth, cookies ou corpos.

## Task 1 — Worker, configuração declarativa e testes

**Files:** Create `deploy/cloudflare/edge-worker.mjs`, `deploy/cloudflare/resources.json`, `deploy/cloudflare/README.md`, `scripts/cloudflare/edge-worker.test.mjs`; modify `package.json` and the existing project-validation test step in `.github/workflows/_validate-project.yml` only as necessary.

**Interfaces:** Default export `{fetch(request, env, ctx)}`. Env: PUBLIC_ASSETS R2, ASSET_RELEASE exact lowercase 40-hex SHA, ASSET_CACHE_SECONDS integer 60..31536000, APP_MODE maintenance/application, optional APP service. Manifest records account/zone/host, three bucket names, Worker metadata (compatibility date, bindings, safe observability), no secrets. Default mode maintenance and immutable app release `fa7e1526a7c469843f1a18168ea5c0e558768ac1`.

- [ ] Write meaningful failing tests for the spec's requests and failures, then run them RED before implementation.
- [ ] Implement the bounded, streaming Worker and declaration; do not add fallback origin, retry or catch-all public storage.
- [ ] Add `test:cloudflare` and reuse the existing validation workflow; do not introduce a duplicated workflow.
- [ ] Run tests, syntax/config checks and relevant policy checks. Self-review and commit explicit owned paths.
- [ ] Independent review of complete source diff; fix/retest findings before deployment.

## Task 2 — Configure and verify the live Cloudflare resources

**Owner:** root; no parallel source writer.

- [ ] Read-before-create the three exact buckets and new Worker; do not replace existing resources owned by others.
- [ ] Create missing private buckets, verify public access off, no destructive expiration; preserve the old backup bucket.
- [ ] Publish exact reviewed Worker and metadata first on workers.dev, with asset TTL 60 and production mutation forbidden until source checks pass.
- [ ] Upload one uniquely named synthetic asset to the asset bucket, verify streaming GET/HEAD/ETag/no private reads and dynamic 503, then remove only that test object. Restore TTL 31536000 and verify source/settings readback.
- [ ] Review the public DNS A record and unrelated Worker routes immediately before the change. Save rollback evidence; create host-specific route then turn on proxy for that A record only.
- [ ] Verify public TLS, HTML 503, API/health 503 no-store, private paths inaccessible, synthetic asset removed after cache expiry, and original DNS content/unrelated routes unchanged.
- [ ] PR/checks/merge under normal protections; record deployed Worker version/source identity. No native paid runtime or bank migration.

## Follow-up required for the complete ERP

Recover current PostgreSQL data and authentication secrets/keys; choose a managed PostgreSQL plan; validate Linux runtimes and external services; prepare and restore-test full R2 backups; activate paid resources only after a concrete cost/access decision. These are not fulfilled by this first edge delivery.
