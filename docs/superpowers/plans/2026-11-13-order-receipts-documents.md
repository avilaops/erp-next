# Order receipts and supporting documents implementation plan

> **For agentic workers:** use superpowers:executing-plans or superpowers:subagent-driven-development task by task; preserve the shared interfaces below.

**Goal:** Record successive receipts with original proofs, expose the same real balance and document history in Order, Finance and Contract, and permit new proofs after signing.

**Architecture:** Finance owns receivables, settlements, reversals, account postings and commission effects. A private supporting-document service stores immutable content and order/payment associations; Order and Contract compose those resources instead of copying payments or signed PDFs. Extend the existing receipt command to persist an optional proof in its transaction.

**Tech stack:** Existing Rust/Axum/SQLx/PostgreSQL, Next.js/React, existing command/session hooks and Playwright; no new dependencies or services for supporting documents.

**Spec:** `docs/telas/vendas/pedidos/referencias/RECEBIMENTOS-E-DOCUMENTOS.md` and the client's local audio transcription.

## Global constraints

- Work only in `C:/Users/nicol/source/erp-next-main`; no extra worktrees, real payments, emails or signatures during tests.
- Explicit tenant isolation, existing feature permissions, If-Match and Idempotency-Key; never infer payment from uploading a file.
- Money remains decimal text at the boundary and integer cents in the ledger. Reuse existing partial/overpayment/reversal rules.
- Proofs are append-only and private. Preserve signed-PDF bytes; appending support documents must not alter signature state.
- No dispatch-payment blockade is added: the audio describes a collection schedule, not an approved global release policy.

## Shared interfaces

New routes (backend `/api/v1`, frontend `/api/erp`):

- `GET /orders/{id}/finance`: `OrderFinanceSnapshot { tenantId, orderId, orderStatus, orderAmount, titleAmount, receivedAmount, outstandingAmount, state, canEdit, receivables: ReceivableSnapshot[] }`. State is `not_originated|open|partial|paid|cancelled|inconsistent`. Requires finance.receivables.read. Every title appears once; each carries its current revision/payments.
- `GET /orders/{id}/documents`: `{ tenantId, orderId, canAttachOther, canAttachPayment, data: SupportingDocument[] }`. Other documents require sales.orders.read; payment-proof visibility requires finance.receivables.read. Filter by these rights rather than granting financial rights through Sales.
- `POST /orders/{id}/documents`: `{ paymentId?: UUID|null, document: SupportingDocumentInput }`; requires Idempotency-Key, no parent-revision dependency because adding immutable evidence does not edit the order. A payment-linked proof requires finance.receivables.manage/read; general documents require sales.orders.manage/read. Payment must belong to a receivable of this order and tenant. Permitted after signing/payment/cancellation while retaining original evidence.
- `GET /orders/{id}/documents/{documentId}`: same parent/feature authorization, private attachment response.
- `SupportingDocumentInput { filename, mediaType, contentBase64, description, documentDate?: ISO-date|null }`; accept PDF, PNG, JPEG with matching file signatures, at most 10 MiB decoded. SupportingDocument metadata includes id, orderId, paymentId?, filename, mediaType, byteSize, sha256, description, documentDate?, uploadedAt, uploadedBy.
- Existing `PaymentInput` gets optional `supportingDocument` and `paymentMethodId`; old callers remain valid. Optional proof is accepted only for receivable receipts and stored atomically with them. Optional method ID preserves actual configured payment identity and its historical label while retaining existing coarse enum compatibility. No raw file bytes/base64 in audit or command fingerprints.

## Review focus

- Multiple attachments must not multiply a payment in aggregate totals.
- Financial-only operators and sales-only users must receive only the data/documents their feature rights authorize.
- Lost responses and concurrent uploads/receipts must not duplicate money or evidence.
- Reversal/cancellation must preserve proof files and derive the correct net balance, including multiple installments.
- Draft/no-title, cancelled and inconsistent-title orders must not be displayed as paid.

## Task 1 — Finance projection and private supporting documents

Files: existing `apps/api/src/domains/finance.rs`, `settlements.rs`, domain/router/OpenAPI registration; new focused order-finance/supporting-document modules, additive migration and real API tests.

- [ ] Write failing tests for 100000 → 50000 → 10000 → 40000, all-title aggregation, duplicate/retry and reversal; financial/sales-only authorization; original-proof upload and post-signature addition.
- [ ] Run the focused failing tests; implement shared interfaces, migration/RLS/immutable content and same-transaction receipt proof persistence. Reuse all current ledger/account/commission behavior.
- [ ] Verify invalid/oversized/cross-tenant proof cannot change finance; proof-only addition does not change received amount or original signed-file hash.
- [ ] Run Rust fmt, focused tests, then complete API checks in CI; export updated OpenAPI and generated consumer types.

## Task 2 — Shared interface in Order, Contract and Finance

Files: new `apps/web/src/features/finance/order-finance.tsx` and focused helpers; existing order, contract and receivable compositions; BFF route/proxy support; browser tests. Read `apps/web/AGENTS.md` and installed Next.js guides before changes.

- [ ] Write browser tests for real versus negotiated balance, repeated receipts and later proof, permissions and narrow screens.
- [ ] Implement shared panels using Task 1 contracts and current useCommand/useResource behavior. Include amount/date/method/reference/account and optional proof; allow selecting the correct installment.
- [ ] Reuse the same document list/history on contracts via their orderId. Reuse it on receivable details, scoped to that title's payments. Keep PDF/audit viewers independent.
- [ ] Implement bounded BFF forwarding for these exact paths; existing contract 64 KiB JSON limit is insufficient for proof upload. Preserve origin/session/tenant/Idempotency-Key/If-Match safeguards.
- [ ] Run focused Playwright at representative widths, lint/typecheck and then full Release browser suites.

## Task 3 — Replacement Ludus template

Files: `apps/api/src/domains/contracts/templates.rs`, focused structured defaults/validation beside model.rs; `apps/web/src/features/contracts/contract-fields.ts`; documented 17-page PDF and 148-field definition under local artifacts.

- [ ] Test the required 148 fields and proposed maximum 200, rejecting 201 and invalid positions as before.
- [ ] Bind split customer address/phone, indexed item cells and real known monetary/payment data; retain manual legal/logistics choices where no authoritative source exists. Do not silently truncate more items than a template represents.
- [ ] Validate exclusive X-mark choice groups and date/currency formatting, preserving old templates and immutable generated contracts.
- [ ] After tests/deployment, upload the reviewed PDF and definition as a new template version with exact tenant, revision and idempotency; preserve old versions and Nicolas's technical no-value contract.
- [x] Align the portal validator's 100-field cap with the proposed 200 and add standalone/integration coverage. The standalone validator observed RED at 148 and GREEN at 148/200, with 201 rejected, in a network-disabled read-only disposable container; production Rails/database were not accessed.
- [ ] Run the manual `regression.yml` task `contracts-portal` on the integrated revision; after its isolated publication/access checks pass, activate that exact portal image preserving existing configuration, volumes and template history. ERP cap alone cannot publish 148 fields to an old 100-field portal.

## Task 4 — Review, integration and publication

- [ ] Review the complete diff against the module inventory and test the cross-module scenario with synthetic records.
- [ ] Required CI gate → PR merge under branch policy → explicit full Release → production health/source verification. Do not publish with blocking failures.
- [ ] Verify non-destructive production reads; real payment registration and individual certificate signing require the actual operator/signatory action.
- [ ] Report exact remaining ICP-Brasil work separately; timestamp completion in DocuSeal is not cryptographic ICP validation. Continue the separate individual-ICP design without marking the overall goal complete prematurely.

## Execution notes

- CI fix PR #203 merged as `81db794acd64554992b478ced1973d3c5ff10034`; required CI run `43380126564` succeeded in 9m25s. Both temporary merged CI branches were removed safely.
- Release run `43381569822` stopped before activation: API, architecture, company/compatibility contracts and web build passed; three browser tests retained old 16px expectations while the source policy now requires 18px mobile controls. Root corrected four assertions in catalog/navigation/simulator tests; focused reruns and complete Release validation remain required. Production has not changed.
- CI timing CSV: `artifacts/ci-runtime-43380126564/tempos-scripts.csv` (27 scripts, zero failures). Failed Release CSV: `artifacts/ci-runtime-43381569822/tempos-scripts.csv` (62 scripts, two failed shard processes). Parallel durations must not be added to infer total elapsed time.
- Native Windows test-binary build completed after 18m08s; actual old-API HTTP RED confirmed missing finance route and 148-field rejection. The changed implementation will use metadata checks locally and complete real SQLx execution in required CI; do not restart/repeat obsolete LLVM work merely because observation yielded.
