# ERP managed PostgreSQL and Cloudflare runtime

The user requests implementation of the discussed Supabase PostgreSQL, Cloudflare execution and private R2 architecture, retaining the ERP's business behavior. The previous independent edge is already deployed; it is maintenance, not the application. Existing current-data recovery remains unresolved. No Redis dependency exists in the API/web; a Redis service occurs only in regression CI. Do not add Redis, Upstash, KV or a queue without a demonstrated consumer.

## Approach and boundaries

Preserve native Rust/SQLx and Next.js. Rewriting these services into Workers or duplicating SQL behind an HTTP gateway would risk financial and tenant rules. Prepare one stateless Cloudflare Container containing the already-built API and web images: this preserves the BFF's loopback API connection, avoids public API credentials and needs one runtime instance. PostgreSQL stays managed in Supabase, and the existing public-asset Worker remains the external entry. Hyperdrive stays available for actual Worker database consumers; native SQLx uses a direct/session PostgreSQL connection. Transaction-pool compatibility and cache are not assumed.

Use immutable API/web image digests from a validated release. Build only a thin combined runtime image; do not compile on an application server. Provide supervised process lifecycle, internal API readiness before web traffic and failure propagation. A runtime Worker starts only after an explicit activation flag and complete secret configuration, reuses one container instance, waits for readiness and forwards each user request once. It must not retry uncertain business operations or fall back to the blocked VPS. Keep public maintenance until recovered-data, auth, fiscal and contract prerequisites are demonstrated.

## Managed database

Implement a client-side preflight/backup utility with credentials in environment variables, never command arguments/output. Validate PostgreSQL endpoint/project identity and strict TLS for remote connections. Separate migration/admin credentials from a non-owner, non-superuser, non-BYPASSRLS runtime role. Preserve the existing public/system_config/legacy_evolution schemas and SQLx migration history/checksums. Reject missing/current-data-incompatible schemas and changed/failed/unknown migrations. Report recovery readiness separately from connection/schema readiness: an empty or legacy database must never become production by passing SELECT 1.

Backups must include data and migration history, stream to a private local file, validate successful completion and record byte size/SHA-256. Do not label a schema export or an empty new bucket as a business-data backup. Existing documents remain in their current authoritative storage until a verified transfer can preserve hashes and access rules. R2 buckets for future private-file and backup publication are already isolated; no blind movement, public grant or destructive lifecycle rule is allowed.

## External gates

The user selected avilaops's Org and subsequently directed source/test completion without waiting for remote infrastructure. The Supabase connector lists no accessible project; no project or nonzero subscription has been provisioned. Cloudflare Containers list explicitly returns 401 requiring Workers Paid. Prepare and test source/configuration first; present exact deployment and quoted cost before activating a paid plan. Native Supabase Auth is not a drop-in replacement for the existing origin-only OIDC configuration; existing identity subjects and membership must be preserved during a separately validated identity transition.

The current financial-server block does not authorize replacing current data with an empty database or the previously inspected legacy ERP dump. No actual messages, payments, fiscal transmissions or signatures as test fixtures. PR207 remains separate from this increment; resume the accepted-order implementation after this source increment, as directed by the user.

## Acceptance

Managed-database tooling rejects unsafe connections, privileged runtime roles, incompatible ledgers and empty production recovery, and produces a verified full backup without credential disclosure. Supervision and Worker tests cover startup, readiness, disconnect/failure and exactly-once forwarding. Existing edge tests remain green. Real Supabase/container verification and production activation are reported pending until their external gates are satisfied. Keep the four unrelated untracked paths untouched and use only this checkout.
