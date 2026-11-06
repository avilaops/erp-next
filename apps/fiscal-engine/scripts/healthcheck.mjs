const token = process.env.ERP_FISCAL_ENGINE_TOKEN ?? "";
const port = Number(process.env.FISCAL_ENGINE_PORT ?? 8091);

if (token.length < 24 || !Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);

try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  const healthy = response.status === 200 && body?.status === "ok"
    && Array.isArray(body.environments)
    && ["homologation", "production"].every(environment => body.environments.includes(environment));
  process.exit(healthy ? 0 : 1);
} catch {
  process.exit(1);
}
