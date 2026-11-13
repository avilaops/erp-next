# Independent ERP edge

## Prepared native application runtime

`runtime-resources.json` is a separate **inactive operator inventory**, not a
Wrangler/cf configuration or a raw Cloudflare REST request body. It describes the
runtime to provision after source verification and infrastructure approval. Map
its worker modules/settings, SQLite-backed Durable Object namespace and native
`durable_object` scheduling-policy image map to the current deployment API. No
runtime has been deployed and the existing edge remains in maintenance.

The runtime keeps Rust/SQLx and Next.js in one stateless Linux Container. The API
listens only on127.0.0.1:8080; web listens on3000 and connects to the API through
loopback. PostgreSQL is external. The supervisor starts the API, waits for actual
readiness, then starts web. It does not run migrations. A process failure stops
its sibling; SIGTERM shuts both down, with a bounded kill deadline. Per-process
allowlists keep database/SMTP credentials out of web and the session secret out
of the API. Migration/admin credentials and arbitrary operator environment never
enter the Container through this runtime bridge.

Build `runtime.Dockerfile` from validated API/web **digest** inputs from the same
release, not mutable tags. The web image contributes Node and its standalone
output; the existing API image retains its native/TLS/ICP dependencies. No build
or durable business state belongs on a runtime instance. The native Container API
requires a Workers Paid account; preparing this source does not activate a plan.

`build-runtime.py` reuses the strict `erp-release/1` manifest contract already
produced by Release. It accepts only the expected source SHA and owned registry
digests. It reads three exact Git blobs to construct an isolated build context,
so unrelated/untracked files, backups and credentials are never sent to Docker.
Default behavior is a plan; `--build` builds locally without pushing or activating:

```text
python deploy/cloudflare/build-runtime.py --release-json <validated-release.json> --source-sha <sha>
python deploy/cloudflare/build-runtime.py --release-json <validated-release.json> --source-sha <sha> --build
```

Use these in the existing reviewed CI packaging process after its native image
producers pass. The helper does not bypass the CI gate, attest an arbitrary input
manifest, enable a paid plan, publish an image or modify an application route.

`runtime-worker.mjs` exports the native Durable Object class and delegates to
`runtime-core.mjs`. This uses `ctx.container` with a digest-pinned `images.base`,
bounded idle timeout and real API/web readiness probes. It never forwards a user
command before readiness and never retries one after forwarding. It preserves
the original request/response streams, cookies and idempotency key. Concurrent
cold requests share startup. A running different image returns503 for explicit
rollout rather than destroying a potentially active business operation.

The runtime fails closed unless RUNTIME_MODE=application, the exact source and
activation SHA match, recovered-data and auth prerequisites are explicitly
verified, and required credentials/configuration validate. These operator flags
record prerequisites; they do not themselves recover data or validate a server.
The PostgreSQL URL must identify the selected Supabase project and use strict
TLS/direct or session mode. The managed preflight must separately verify the
role's actual permissions; a username check is not a privilege audit.

Background workers default off in this inactive declaration. Before activation,
review payroll/fiscal schedules, choose their real execution strategy and set
ERP_BACKGROUND_WORKERS_ENABLED explicitly. On-demand Containers can sleep;
periodic work must not silently depend on user traffic. Fiscal engines, signing
portal and OIDC issuer are independent service prerequisites. The portal's Redis
dependency must be preserved or replaced only after actual compatibility tests.

After real runtime verification, configure the existing edge's APP service
binding and application mode. Its public R2 binding remains PUBLIC_ASSETS only;
private documents and backups are never attached to the public edge. A runtime
bridge does not transfer the API's existing bytea documents to R2: preserve them
until a separate hash-verified storage migration can be completed with the data.

See `../supabase/README.md` for managed database checks and the full restore test.

This Worker serves public Next.js build assets from private R2 storage while the
ERP application is unavailable. Dynamic requests return an honest `503` with
`Retry-After: 60`, `Cache-Control: no-store`, HTML for browser navigation and JSON
for APIs. `/api/health` reports `ok: false`. This edge does not recover the ERP,
authentication, contract portal, database or business data.

## Resource declaration

`resources.json` is an operator resource inventory for Cloudflare REST deployment,
**not a Wrangler configuration**. Its `worker.bindings` contains R2 bindings;
translate `worker.vars` to plain-text bindings when uploading module metadata.
`worker.main` is relative to this directory. Upload `edge-worker.mjs` as the main
ES module, using `compatibility_date` and `observability` from the declaration.
Account, zone and hostname are recorded explicitly; this file contains no secrets.

The three separately named buckets must remain private: disable `r2.dev` access,
attach no public bucket domain, add no generic CORS or destructive lifecycle rule.
Only `avilaops-erp-next-assets` is bound as `PUBLIC_ASSETS`. Documents and backups
have no Worker binding and cannot be served through this Worker. An empty backup
bucket is not a backup. The previously inspected legacy dump did not contain the
current `erp_next` database; its recovery remains a separate prerequisite.

## Public asset contract

Upload only reviewed public build output from `.next/static/` under:

```text
releases/<ASSET_RELEASE>/_next/static/<relative-build-path>
```

`ASSET_RELEASE` must be exactly 40 lowercase hexadecimal characters and identifies
the application build, independently of the Worker source commit. Its initial
value is `fa7e1526a7c469843f1a18168ea5c0e558768ac1`. Never overwrite a published
release namespace: upload a complete new namespace before selecting its SHA.
Do not upload source maps, HTML, private files, configuration or database dumps.

Only `GET` and `HEAD` under `/_next/static/` can read R2. Allowed extensions are
`.js`, `.css`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.png`, `.jpg`, `.jpeg`, `.gif`,
`.webp`, `.avif`, `.ico`, `.svg` and `.wasm`. Types are fixed by the Worker;
uploaded HTTP metadata is ignored. Paths are limited to 2,048 characters and
32 segments of at most 255 characters. Segments accept ASCII letters, digits,
underscores, parentheses, brackets, `@`, dots and hyphens, and must not start
with a dot. Percent escapes, Unicode, backslashes, empty segments and unknown
extensions are rejected. Standard URL dot-segment normalization may already
have removed traversal sequences before the Worker receives the request; no
normalized request can escape the fixed public release prefix in R2.

The cache key is a fresh GET URL containing the release and path. Query strings,
cookies, Authorization and other client headers never enter the asset cache key
or R2 call. Only successful public asset `200` responses are written. HEAD uses
cached metadata or `R2.head`, returns no body and never stores an empty response.
Quoted R2 `httpEtag` is returned unchanged; matching strong/weak If-None-Match,
lists and `*` produce a bodyless `304` without storing it.

Bodies stream from R2. A cache copy has at most one queued chunk. If the cache
falls behind, fails or the client disconnects, its stream is aborted so partial
objects cannot become successful cache entries; the client stays independent
of cache availability. A source-stream failure after headers have been sent
terminates that response; it cannot be converted into a different HTTP status.
No full asset buffer or unbounded `Response.clone()` tee is used.

## Modes and staged operation

`APP_MODE` accepts only `maintenance` or `application`; omission defaults to
maintenance. Invalid modes, releases and TTLs fail closed before storage or
cache I/O. `ASSET_CACHE_SECONDS` accepts an integer from 60 to 31,536,000 seconds.
The source declaration uses `60` for remote canary testing; production promotion
uses `production.ASSET_CACHE_SECONDS` (`31536000`). Headers use seconds directly:
`public, max-age=60, immutable` then `public, max-age=31536000, immutable`.

Future `application` mode requires an independently hosted `APP` service binding.
It forwards the original Request exactly once and returns the original Response,
preserving streamed bodies, cookies, authentication headers and status. Missing
or failing APP returns `503`; there is no origin fallback or automatic retry.
Public static paths remain owned by the asset handler in either mode.

Before any public route change, the operator should:

1. Inspect the actual private bucket settings and the uploaded Worker metadata.
2. Deploy initially on workers.dev in maintenance with TTL 60. Upload a synthetic
   public asset under the selected release and test GET, HEAD, ETag, rejected
   paths, APIs and health against the real runtime. Delete only that object after
   the canary; use a fresh synthetic name to avoid the short-lived cached copy.
3. Confirm the observed Worker logs/traces configuration. Logs and sampled traces
   are enabled, query strings redacted, invocation logs disabled; the source emits
   no raw cookie, Authorization, query or body logs.
4. Promote the asset TTL to 31,536,000 after the canary and verify the actual
   deployed version and configuration again. Reusing a release during this
   promotion can retain canary cache entries for at most the original 60 seconds.
5. Record the existing DNS record/proxy flag and existing Worker routes for
   rollback. Change only the existing A record for `erp.avilaops.com` to proxied,
   preserving its IP, and create only the declared exact-host route. The source
   declaration leaves `route.enabled` false until these gates pass. Preserve
   other DNS/TXT records, Worker routes and global zone settings.

For rollback, restore the recorded route and DNS proxy state. Code configuration
rollback must select the previous Worker version and its corresponding asset
release. Do not erase buckets, uploads or application data as part of rollback.
Keep edge availability and ERP application availability separate in reports.

## Local validation

No new dependency or paid service is needed. Node 24 runs the native Web API
tests; external R2 and Cache APIs use controlled test doubles. Local tests do not
replace the real workers.dev canary and deployment metadata inspection.

```text
node --check deploy/cloudflare/edge-worker.mjs
node --check scripts/cloudflare/edge-worker.test.mjs
pnpm test:cloudflare
```

The existing project-validation test step runs this suite alongside
`test:verification`; no duplicate workflow is introduced. The suite also parses
the JSON declaration and checks binding separation, observability and TTL
behavior using the declared vars.

Cloudflare API references used for this implementation:
[R2 metadata, streams and httpEtag](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[Cache API headers and failures](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/),
[Worker configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).
