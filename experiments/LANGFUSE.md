# Experiment tracing

Tracing is optional and disabled by default. Configure the experiment process
through its secret manager with `LANGFUSE_ENABLED=true`,
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL`.
The base URL must use HTTPS without embedded credentials, query or fragment.
`LANGFUSE_TRACING_ENABLED` remains a compatibility alias; `LANGFUSE_ENABLED`
takes precedence. Restart after changes. Safe environment/release labels can be
provided as `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`.
Never commit keys or paste them into chat.

Requires Langfuse Cloud v4 or self-hosted Langfuse >= 4.59.0 (JS SDK 6.0.2).
OpenTelemetry 0.220.0 exporters and SDK are pinned together because 0.300.0
requires API 1.10 while Langfuse currently requires API 1.9.

`run-experiment` nests executor spans and evaluator observations. Only numeric
counts, repetition numbers and completion flags are exported. Dataset content,
model inputs, outputs, identities, exception messages and credentials are excluded.
This deterministic runner creates no invented LLM generations, model names,
token counts or costs. Tool tracing belongs to the standalone experiments package;
this embedded version has no registered tool executor.

Call `await flushObservability()` before exiting short-lived library consumers.
The API drains telemetry on SIGTERM/SIGINT after draining requests. The SDK also
shuts down on `beforeExit`. Export HTTP timeout is three seconds, media upload is
disabled, and only known operation names from the Langfuse SDK are exported.
Telemetry failures preserve application
results and never retry dispatched business operations.

Run `npm ci --no-audit --no-fund` and `npm test` from `experiments/` exclusively
in GitHub CI. Live trace delivery requires project credentials configured in an
authorized environment and remains unverified until that check is performed.
