# Product technical sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution was already established in this session. One independent whole-branch review at the end.

**Goal:** Create editable technical fields in ERP and Sheet and populate94 confirmed products.
**Architecture:** Extend existing product_catalog_profiles with optional source metadata and optional main media; preserve legacy photos and existing public publication behavior. Use optimistic revisions including revision0 creation, product locks and tenant-scoped audit/outbox.
**Tech Stack:** Rust/Axum/SQLx/PostgreSQL, Next.js/React/TypeScript, Playwright, Google Sheets MCP.
**Spec:** docs/superpowers/specs/2026-11-12-product-technical-sheet-design.md

## Global Constraints
Preserve commercial/fiscal/product identity/color/stock fields and other tenants. Do not publish external catalogs or send emails/fiscal operations. Existing user changes in source workspace remain untouched. Build locally; never compile on the application server.94 unique approved matches only;10 catalog-only and66Core remain explicit pending/out-of-scope records.

## Review Focus
- Concurrent creation/update must fail stale revision without losing edits.
- Existing clients omitting new metadata must preserve it.
- No profile/main media/gateway must retain the legacy product image.
- Foreign tenant, invalid source URL/page and invalid dimensions must reject safely.
- A failed/uncertain save must preserve the draft; readers cannot create/edit.

### Task1: Persist and expose technical fields
**Files:** migrations/202611120001_product_technical_sheet.sql; apps/api/src/domains/catalog_publication.rs; apps/api/src/domains/catalog.rs; apps/api/src/http/domain_tests.rs; generated API contract artifacts as required.
**Interfaces:** GET /products/{id}/catalog returns existing snapshot with data:null,defaultCollection,mediaConfigured for missing profile and ETag0. PUT CatalogProfileInput adds optional manufacturer,manufacturerModel,catalogProductName,liveArea,catalogSources; mainMediaId accepts null.
- [ ] Add API regression tests: create missing profile without media, unchanged legacy photo/price, readback metadata, stale create/update, omission preservation, invalid sources and foreign tenant.
- [ ] Run targeted tests and observe intended failure.
- [ ] Implement migration, validated input and optional metadata, product lock, create/update semantics, tenant isolation, audit/outbox; preserve publication join.
- [ ] Run targeted API suite and formatting; generate and check contracts.
- [ ] Commit backend.

### Task2: Compact product technical sheet editor
**Files:** apps/web/src/features/catalog/catalog-profile.tsx; apps/web/src/features/catalog/catalog-workspace.tsx; focused model/helper only if required; apps/web/tests/catalog-technical-sheet-ui.spec.ts.
**Interfaces:** Uses Task1 snapshot and revision0 creation with typed fields. Parent supplies view/edit mode; basic product form remains independent.
- [ ] Add browser cases for empty technical sheet creation, populated display/edit,320/390/768/1440 layout, reader, stale revision, network failure and draft preservation.
- [ ] Run and observe missing-feature failures.
- [ ] Implement compact section, optional sources, field constraints, safe links, edit mode and conflict recovery; gate gallery on mediaConfigured.
- [ ] Run focused browser tests, affected catalog regressions, TypeScript and lint, local production build.
- [ ] Commit UI; obtain independent whole-branch review and fix critical/important issues with focused regression.

### Task3: Release and complete matching data
**Files:** operational artifacts in source artifacts/catalog-drive-20261112; new docs relation/import report where appropriate.
**Interfaces:** Task1 deployed API supports profiles with main_media_id null. Use the user's existing spreadsheet and selected Google account, recorded in ignored operational artifacts. The user requested one tab, with one row per supplier model; Core is outside these PDFs.
- [ ] Review94 mappings; record three visual confirmations and91 metric/name confirmations; preserve complete before snapshots.
- [ ] Create/merge reviewed PR, locally package API/web, back up schema, apply SQLx migration and compatible runtime images preserving private configuration.
- [ ] Dry-run tenant-scoped94-profile import with all protected-field fingerprints, then apply with backup and audit/outbox.
- [ ] Read back94 profiles/API and verify commercial fields/photos/other tenants unchanged.
- [x] Consolidate the existing spreadsheet to one tab, with104models,94Premium ERP links,42applicable plate-holder classifications and preserved reference sections. Core is excluded. Fill only authoritative ERP fields and preserve unknowns.
- [ ] Verify every written Sheet range, counts, source references, native formatting and original model preservation.
- [ ] Archive ledger and deliver native Sheet plus concise ERP result.
