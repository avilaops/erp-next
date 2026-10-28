# Received NF-e and Lojas Integration Implementation Plan

> **Execution:** Follow `superpowers:executing-plans`. Application tests and builds run only in
> GitHub CI, per repository policy.

**Goal:** Implement tenant-safe received NF-e storage and the exact service contract required by
Lojas for list, XML download, and DANFE download.

**Architecture:** Add forced-RLS persistence for service credentials and received documents.
Interactive OIDC routes manage keys and import XML. A separate tenant-bound service-key middleware
protects the Lojas contract. The existing XML inspector and DANFE client are reused.

**Stack:** Rust 2024, Axum 0.8, SQLx/PostgreSQL 18, Utoipa, roxmltree, SHA-256, GitHub Actions.

---

## Task 1: Specify the contracts with failing tests

**Files:**

- Create: `apps/api/src/http/received_nfe_tests.rs`
- Modify: `apps/api/src/http/mod.rs`
- Modify: `apps/api/src/http/openapi.rs`

1. Add integration tests for service-key creation, one-time secret disclosure, hash-only storage,
   listing, revocation, invalid credentials, and tenant isolation.
2. Add import tests for exact XML preservation, recipient enforcement, metadata extraction,
   idempotent replay, conflicting replay, and RLS isolation.
3. Add Lojas contract tests for list shape, numeric identifiers, XML headers/content, DANFE
   headers/content, missing records, revoked keys, and renderer failure.
4. Add OpenAPI assertions for management, import, and service endpoints.
5. Commit and push the tests without implementation; record the expected failing GitHub CI run.

## Task 2: Add tenant-safe persistence and service credentials

**Files:**

- Create: `migrations/202610280001_received_nfe_integrations.sql`
- Create: `apps/api/src/platform/service_auth.rs`
- Modify: `apps/api/src/platform/mod.rs`
- Modify: `apps/api/src/http/mod.rs`
- Modify: `apps/api/src/http/openapi.rs`

1. Create the service-key and received-NF-e tables, indexes, constraints, permissions, and forced
   RLS policies.
2. Implement tenant-bound key generation using UUID-v7 entropy, SHA-256 hashing, strict parsing,
   revoked-key rejection, and last-use recording.
3. Implement authenticated create/list/revoke handlers requiring
   `platform.integrations.manage`.
4. Mount service routes outside the OIDC middleware and inject only the authenticated service
   tenant/key identity.

## Task 3: Implement received NF-e import

**Files:**

- Create: `apps/api/src/domains/fiscal/received.rs`
- Modify: `apps/api/src/domains/fiscal/danfe.rs`
- Modify: `apps/api/src/domains/fiscal/mod.rs`
- Modify: `apps/api/src/http/openapi.rs`

1. Refactor the shared XML inspection result to expose validated metadata without changing the
   existing DANFE validation boundary.
2. Parse issuer name, number, series, issuance time, total cents, and item count with strict bounds.
3. Require the active tenant to be the recipient.
4. Insert the exact XML and hash atomically; return the existing row for an identical replay and
   `409` for a changed document using the same access key.
5. Record audit and outbox evidence for the first import only.

## Task 4: Implement the Lojas service contract

**Files:**

- Create: `apps/api/src/domains/fiscal/lojas.rs`
- Modify: `apps/api/src/domains/fiscal/mod.rs`
- Modify: `apps/api/src/http/mod.rs`
- Modify: `apps/api/src/http/openapi.rs`

1. List tenant notes in the exact `{notas, pendencias}` schema expected by Lojas.
2. Return original XML with safe attachment headers.
3. Render and return DANFE through the configured fiscal renderer with the same conservative
   authorization claims as the existing endpoint.
4. Recheck key revocation after long-running DANFE generation before returning the PDF.

## Task 5: Document, verify, and open the pull request

**Files:**

- Create: `docs/INTEGRACAO-LOJAS-NOTAS-RECEBIDAS.md`
- Modify: `docs/STATUS-ERP.md`
- Modify: `docs/DANFE-CONTINUACAO.md`

1. Document key provisioning, Lojas environment variables, import workflow, response contract,
   validation boundaries, rotation/revocation, and deferred capabilities.
2. Format sources and run `git diff --check` locally; do not run application tests or builds.
3. Push the implementation, wait for all pull-request CI jobs, and correct every failure through
   CI-only iterations.
4. Perform a focused self-review for auth bypass, tenant leakage, secret leakage, idempotency,
   unsafe content headers, and misleading fiscal claims.
5. Update AVL-360 with commit, CI, and pull-request evidence. Do not merge or deploy.
