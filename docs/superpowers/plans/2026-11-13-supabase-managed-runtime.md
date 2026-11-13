# Supabase managed PostgreSQL and Cloudflare runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare, test and integrate the native ERP with managed PostgreSQL and a Cloudflare runtime, then provision/activate only after account, cost, identity and recovered-data gates pass.

**Architecture:** Keep Rust/SQLx and Next.js, combine validated immutable API/web images behind a private loopback connection, and retain the independent edge. Managed PostgreSQL remains the authoritative store; no Redis is required. Native SQLx does not pretend to consume a Workers-only Hyperdrive binding.

**Tech Stack:** Python standard library/libpq clients, Node built-ins, Cloudflare Workers native Durable Object Container API, PostgreSQL/Supabase, existing OCI images.

**Spec:** docs/superpowers/specs/2026-11-13-supabase-managed-runtime-design.md

## Global Constraints

- One existing checkout; preserve original four unrelated untracked paths.
- No nonzero subscription, production empty database, issuer/identity rewrite, private-file exposure or business transaction.
- No new Redis/SQL proxy dependency; public maintenance stays active until real prerequisites pass.
- Credentials stay in server-only environment/secrets, never argv, public code or tool output.
- Full data backups and exact SQLx checksums; separate runtime and migration roles.

## Review Focus

- URI parser edge cases must not leak credentials or silently weaken TLS/project identity.
- Missing/partial/foreign or RLS-hidden data must not be called recovered production data.
- A failed subprocess/partial backup must not leave a successful backup manifest.
- Container cold starts, concurrent requests and failed readiness must not duplicate a business request.
- Lost external prerequisites must retain truthful maintenance and must not activate the previous VPS.

### Task 1: Managed PostgreSQL preflight and full backups

**Files:** Create deploy/managed-postgres.py, scripts/deploy/test_managed_postgres.py and deploy/supabase/README.md; integrate tests in the existing validation step.

- [ ] Add failing tests for endpoint/TLS/credential handling, exact migration ledger validation, restricted runtime identity, missing/empty recovery, and full/partial backup behavior.
- [ ] Run RED, implement typed preflight and streaming backup through libpq, run GREEN and existing deploy tests.
- [ ] Document migration credentials/runtime credentials and Supabase Data API exposure constraints without modifying existing policies or seed data. Commit and ledger the evidence.

### Task 2: Native stateless runtime and Cloudflare bridge

**Files:** Create deploy/cloudflare/runtime-supervisor.mjs, runtime.Dockerfile, runtime-worker.mjs, runtime-resources.json and focused scripts/cloudflare tests; extend deploy/cloudflare/README.md.

- [ ] Add failing tests for process lifecycle, loopback isolation, read-only startup readiness and forwarding exactly once.
- [ ] Implement a dependency-free process supervisor and current Durable Object Container API bridge; use immutable input images and an inactive declaration.
- [ ] Verify no migration occurs on application start, no schema/admin credentials reach runtime and no private bucket is attached publicly; run GREEN and existing edge tests. Commit and ledger evidence.

### Task 3: Provisioning and end-to-end gates

- [ ] Resolve the pending organization choice and actual project quote before provisioning. Use a validation destination; inspect existing tables before schema work.
- [ ] Validate actual migrated schema/RLS/roles and recovery evidence; never bootstrap fake production data.
- [ ] Prepare combined image from validated API/web digests and verify real runtime where authorized. Present paid Containers activation only with concrete source/tests/deployment configuration and current quote.
- [ ] Keep maintenance if source data, identity, fiscal/contract services or paid authorization is missing. Record exact blocked prerequisites.
- [ ] Request one fresh whole-branch review, fix important findings, run relevant checks and create/update the PR. Integrate only per repository checks; do not run the old VPS release.
