# Lojas Service-Key Management UI Design

**Issue:** AVL-360

**Date:** 2026-10-28

**Status:** Approved by the issue acceptance criteria and the instruction to continue each module

## Intent

Complete the missing interactive part of AVL-360: an administrator must be able to create,
inspect, rotate, and revoke the tenant-bound credential used by Lojas from ERP Next's existing
Preferences / Integrations area. The raw credential is disclosed exactly once so it can be moved
to the Lojas secret store; it must not be persisted by the browser or returned by later reads.

## Approaches

1. **Dedicated Lojas integration detail (selected).** Add a real Lojas card to the existing
   integration catalog and a focused key-management page backed by authenticated BFF routes. This
   matches the existing navigation, keeps tenant selection server-controlled, and clearly separates
   the real integration from simulated provider cards.
2. **Generic credential editor inside the simulated integration detail.** Rejected because the
   current component contains health simulations and placeholder connection actions; mixing real
   credentials into it would make operational state ambiguous.
3. **Direct browser calls to the Rust API.** Rejected because this would expose the OIDC access
   token and tenant forwarding logic to client code instead of reusing the established BFF.

## User flow

- The catalog includes **Lojas Ávila Ops** under the Fiscal category.
- Opening the detail loads existing service keys through the ERP BFF with `Cache-Control: no-store`.
- A user with `platform.integrations.manage` may provide a name of 3 to 100 characters and create a
  key. The BFF forwards the active session tenant and OIDC token; the browser never supplies either.
- The raw key is shown in a dedicated one-time disclosure panel with copy and dismiss actions. The
  panel states that the value cannot be recovered. Dismissing or reloading removes it.
- The list shows name, non-secret prefix, creation time, last use, and active/revoked state. It never
  receives the raw key from the list endpoint.
- Revocation requires explicit confirmation, calls the tenant-bound endpoint, and refreshes the
  list. A revoked key remains visible as audit context and cannot be revoked again.

## Security and failure behavior

- BFF writes require the configured same-origin header and the tenant identifier that matches the
  sealed server session, following the existing proxy contract.
- Dynamic key identifiers must be UUIDs; malformed identifiers return `404` without reaching the
  API.
- Anonymous sessions return `401`; missing permission remains `403`; upstream unavailability is
  rendered as a safe retryable error.
- The raw key exists only in React memory after a successful creation. It is not written to URL,
  cookies, local/session storage, console output, screenshots, analytics, or error messages.
- All BFF responses use `no-store`. The key-management page is usable without horizontal overflow
  at 375 px.

## Verification

Application tests and builds run only in GitHub CI. Playwright uses the real built Next.js
application and a narrowly scoped HTTP test double for the external Rust boundary. Rust integration
tests continue to prove hash-only persistence, RLS, authorization, and revocation independently.

The browser contract covers unauthenticated and cross-origin rejection, tenant forwarding, list,
creation, one-time disclosure, dismissal, reload, revocation, permission failure, and mobile layout.

