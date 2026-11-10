# PDV and sales navigation implementation plan

**Goal:** Operate real cashier sales, closing and history; improve simulator desktop/mobile navigation and expose standalone order email.

**Architecture:** Existing Next.js BFF and authenticated Rust API, PostgreSQL transactions/RLS, current stock and financial ledgers. SMTP uses the existing mail service and durable delivery intents. No automatic fiscal transmission.

**Constraints:** Build locally; no production compilation. Reuse ERP table/controls. Preserve actual tenant data and existing financial policies. No live email, sale or cash movement as a test.

## Work

1. Simulator: focused desktop/mobile navigation tests, compact equipment and collapsible finishes, preserved form state, reachable result/actions; preserve quote invalidation and calculations.
2. POS API: migration, permissions and tenant isolation; current session, opening, stock-safe sales, split tender/change, ledger-backed cash transfers, closing reconciliation, cancellation/refund and searchable history. Reject stale quoted totals and closed-session writes. Idempotency plus optimistic revision on every mutation.
3. POS UI: operational pages at `/vendas/pdv`, `/fechamento`, `/historico`; shared tables, proper loading/errors/permissions, server values and receipts. BFF strict paths/methods/query forwarding. Remove unavailable flags only after persistence is connected.
4. Order email: visible composer, actual recipient/document, durable send state, revision/idempotency, SMTP readiness and errors. Test against fake transport only.
5. Verify focused UI on390px and1280px, TypeScript/lint, isolated database business tests, production frontend build and local Linux API crossbuild. Migrate/deploy compiled artifacts with backup and rollback under existing authorization; confirm public health and local UI. No live business test transactions.

## Review focus

- Never mix companies, accounts, sessions or product stock across tenants.
- Change uses tendered cash only; payment amounts must exactly equal server total.
- Repeated or uncertain commands must not double post inventory, cash or mail.
- Closing/cancellation concurrency must serialize and retain immutable historical totals.
- Keyboard/mobile controls stay reachable; collapsed sections preserve entered data and stale quotes cannot convert.
