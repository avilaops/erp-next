# Received NF-e and Lojas Integration Design

**Issue:** AVL-360  
**Date:** 2026-10-28  
**Status:** Approved for implementation

## Goal

Add the smallest complete ERP Next vertical slice that lets an authorized tenant import an
authorized NF-e process XML and lets Lojas list the received notes and download their exact XML
or generated DANFE PDF.

The legacy ERP is not part of this design and must not be reactivated.

## Scope

- Create, list, and revoke tenant-bound service API keys through the authenticated ERP API.
- Store only a SHA-256 hash and a non-secret display prefix for each service key.
- Import a complete NF-e 4.00 `nfeProc` through the authenticated ERP API.
- Require the active tenant to be the NF-e recipient.
- Preserve the original XML bytes represented by the request string without normalization.
- Make import idempotent by tenant and access key.
- Expose the Lojas-compatible service contract:
  - `GET /api/v1/notas-recebidas`
  - `GET /api/v1/notas-recebidas/{id}/xml`
  - `GET /api/v1/notas-recebidas/{id}/danfe`
- Keep all tenant-owned records behind PostgreSQL forced RLS.

## Non-goals

- SEFAZ distribution by NSU.
- Recipient manifestation.
- Cryptographic ICP-Brasil trust-chain validation.
- Online SEFAZ status validation.
- Supplier, purchasing, cost, accounts-payable, or stock workflows.
- Production deployment or legacy ERP restoration.

## Authentication and authorization

Interactive management and import routes keep the existing OIDC bearer middleware and
`X-Tenant-Id` selection. They require:

- `platform.integrations.manage` for service-key management.
- `fiscal.received_nfe.manage` for import.

The Lojas routes use a dedicated bearer middleware. A key has the form
`erp_<tenant-uuid>_<secret>`. The tenant identifier selects the RLS context; authentication then
matches the SHA-256 hash inside that context and rejects revoked credentials. The raw key is
returned once when created and is never persisted or logged.

## Persistence

`service_api_keys` stores tenant, name, key prefix, SHA-256 hash, creation identity, creation time,
last-use time, and revocation time.

`fiscal_received_nfes` stores a tenant-scoped numeric identity, access key, issuer and recipient
metadata, document number, series, issuance timestamp, total in integer cents, item count,
environment, exact XML text, XML SHA-256, and creation time.

Both tables use forced RLS. `(tenant_id, access_key)` is unique. Reimporting identical XML returns
the existing record; reusing the key with different XML returns `409 Conflict`.

## XML validation boundary

The existing parser remains the shared source for envelope and protocol consistency. It verifies
the NF-e 4.00 `nfeProc` shape, model 55, access-key check digit, issuer/key consistency,
authorization status, protocol/key/environment consistency, signature reference, and digest
agreement. It does not claim XSD validation, certificate trust, signature cryptography, online
SEFAZ consultation, or current authorization status.

Import additionally extracts the issuer name, number, series, issuance timestamp, invoice total,
and item count, and requires the recipient document to equal the active tenant tax ID.

## Lojas contract

The list response is `{ "notas": [...], "pendencias": [] }`. Each note has a numeric `id`,
44-digit `chave`, numeric `numero`, numeric `serie`, ISO-8601 `emitida_em`, numeric `valor`, integer
`itens`, `compra_id: null`, and an unlinked `fornecedor` object.

XML download returns the preserved document as `application/xml` with attachment and `no-store`
headers. DANFE download reuses the configured renderer and returns `application/pdf`; it never
fabricates a PDF when the renderer is unavailable or rejects the XML.

## Failure handling

- Malformed, incomplete, non-authorized, or incompatible XML: `422`.
- XML whose recipient is not the active tenant: `403`.
- Different XML for an existing tenant/access key: `409`.
- Missing, invalid, or revoked service key: `401`.
- Cross-tenant numeric note identifier: `404` under RLS.
- DANFE renderer unavailable: `503`; invalid upstream response: `502` or `422` as appropriate.
- Every document response uses `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Verification strategy

Repository policy requires builds and tests to run only in GitHub CI. Contract and integration
tests are therefore committed first and pushed to obtain the expected failing CI evidence. The
implementation follows in later commits, and completion requires a green pull-request CI run.
Local verification is limited to read-only inspection, formatting, and `git diff --check`.
