# Lojas Service-Key Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized ERP Next administrator manage the Lojas tenant service key from Preferences / Integrations without persisting or redisclosing the raw secret.

**Architecture:** Add two authenticated Next.js BFF route handlers over the existing Rust service-key API and a dedicated client component for the Lojas integration. Extend the existing fiscal browser suite with a real Next.js UI test and an HTTP double only at the Rust boundary.

**Tech Stack:** Next.js 16.4, React 19, TypeScript 5, Playwright 1.64, existing Rust/Axum API.

**Spec:** `docs/superpowers/specs/2026-10-28-lojas-service-key-ui-design.md`

## Global Constraints

- Do not run application tests or builds locally; use GitHub CI exclusively.
- Do not expose an OIDC token, service-key secret, or tenant credential in logs or artifacts.
- Preserve the active tenant from the sealed ERP session and require same-origin writes.
- Keep the legacy ERP out of runtime and implementation scope.

## Review Focus

- A raw service key must disappear after dismissal or reload and never appear in list responses.
- An origin or tenant mismatch must be rejected before the upstream API is called.
- A malformed revoke identifier must not be forwarded.
- A `403` must not leave enabled management actions or reveal upstream details.
- The one-time disclosure and key list must not overflow a 375 px viewport.

---

## Task 1: Specify the browser and BFF contract

**Files:**

- Create: `apps/web/tests/service-key-ui.spec.ts`
- Modify: `apps/web/playwright.danfe.config.ts`

**Interfaces:**

- Consumes: existing sealed `erp_session` cookie and Rust service-key JSON contract.
- Produces: failing browser expectations for `/preferencias/integracoes/lojas` and `/api/erp/integrations/service-keys`.

- [ ] Write tests for BFF authentication/origin/tenant/UUID rejection and precise upstream headers.
- [ ] Write tests for list, create, one-time disclosure, dismiss/reload, revoke, `403`, and mobile overflow.
- [ ] Add the test file to the single-worker fiscal browser configuration.
- [ ] Push the contract-only commit and record the expected failing GitHub CI run.

## Task 2: Implement the authenticated BFF boundary

**Files:**

- Modify: `apps/web/src/lib/erp-proxy.ts`
- Create: `apps/web/src/app/api/erp/integrations/service-keys/route.ts`
- Create: `apps/web/src/app/api/erp/integrations/service-keys/[id]/route.ts`

**Interfaces:**

- Consumes: `forwardErp(request, resource)` and `uuidPattern`.
- Produces: `GET`/`POST /api/erp/integrations/service-keys` and `DELETE /api/erp/integrations/service-keys/[id]`.

- [ ] Allow only the exact service-key collection and UUID resource paths in `forwardErp`.
- [ ] Forward GET/POST and validate the dynamic UUID before DELETE.
- [ ] Preserve `no-store`, safe error mapping, session authorization, and same-origin tenant checks.
- [ ] Push and require the BFF contract tests to pass in GitHub CI.

## Task 3: Implement the Lojas integration screen

**Files:**

- Modify: `apps/web/src/features/integrations/integration-data.ts`
- Modify: `apps/web/src/features/integrations/integrations-catalog.tsx`
- Modify: `apps/web/src/app/preferencias/integracoes/[provider]/page.tsx`
- Create: `apps/web/src/features/integrations/lojas-service-keys.tsx`
- Modify: `docs/INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md`

**Interfaces:**

- Consumes: the Task 2 BFF endpoints and `CreatedServiceKey`/`ServiceKeyPage` JSON shapes.
- Produces: a real `/preferencias/integracoes/lojas` management page.

- [ ] Add the Lojas catalog entry and route it to the dedicated real screen.
- [ ] Load summaries, create a named key, show the raw value once, dismiss it, and revoke with confirmation.
- [ ] Render loading, empty, forbidden, retryable error, active, revoked, and mobile-safe states.
- [ ] Document that provisioning starts in the UI but secret placement in Lojas remains an operational step.
- [ ] Push the implementation and require Rust, web, browser, and inventory checks to pass.

## Task 4: Review and evidence

**Files:**

- Modify: `docs/STATUS-ERP.md`

**Interfaces:**

- Consumes: final CI and inventory runs.
- Produces: review-ready PR and synchronized AVL-360/team evidence.

- [ ] Review the full branch for secret disclosure, auth bypass, tenant leakage, unsafe retries, and misleading production claims.
- [ ] Record the exact CI and inventory URLs in the PR, Linear, and team ledger.
- [ ] Keep the PR unmerged and do not deploy or provision a real key without separate authorization.

