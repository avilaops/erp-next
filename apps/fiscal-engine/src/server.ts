import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dispatch, EngineInputError } from "./engine.ts";

const MAX_BODY = 2_097_152;
function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}
export function createHandler(token: string) {
  if (token.length < 24) throw new Error("ERP_FISCAL_ENGINE_TOKEN exige pelo menos 24 caracteres");
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const candidate = Buffer.from(request.headers.authorization ?? "");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) { reply(response, 401, { code: "unauthorized" }); return; }
    if (request.method === "GET" && request.url === "/healthz") { reply(response, 200, { status: "ok", environment: "homologation" }); return; }
    const match = /^\/v1\/(prepare|authorize|consult|event|void|distribute|manifest)$/.exec(request.url ?? "");
    if (request.method !== "POST" || !match) { reply(response, 404, { code: "not_found" }); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) { reply(response, 415, { code: "json_required" }); return; }
    if (active >= 4) { reply(response, 503, { code: "busy" }); return; }
    active++;
    try {
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > MAX_BODY) { reply(response, 413, { code: "body_too_large" }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { reply(response, 400, { code: "invalid_json" }); return; }
      reply(response, 200, await dispatch(match[1], input));
    } catch (error) {
      // Neither third-party exception messages nor stack traces may reflect A1 material.
      reply(response, error instanceof EngineInputError ? 200 : 502, error instanceof EngineInputError
        ? { status: "blocked", blockers: [error.code], title: error.message }
        : { code: "fiscal_operation_uncertain", title: "Operação fiscal não confirmada; consulte a situação antes de repetir" });
    } finally { active--; }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.ERP_FISCAL_ENGINE_TOKEN ?? "";
  const host = process.env.FISCAL_ENGINE_BIND ?? "127.0.0.1";
  const port = Number(process.env.FISCAL_ENGINE_PORT ?? 8091);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Porta fiscal inválida");
  const server = createServer({ requestTimeout: 45_000, headersTimeout: 10_000 }, createHandler(token));
  server.listen(port, host);
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}
