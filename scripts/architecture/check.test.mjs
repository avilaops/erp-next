import test from "node:test";
import assert from "node:assert/strict";
import { validateStructure, routeSurface } from "./check.mjs";

const prefix = "apps/web/src/";
const policy = { webLayers: { app: "routes", features: "business", lib: "shared", server: "private", components: "ui" }, featureDomains: { fiscal: "fiscal" }, retiredPaths: ["apps/web/src/lib/erp-session.ts"] };
const check = entries => validateStructure(new Map(Object.entries(entries).map(([name, content]) => [prefix + name, content])), policy);

test("client cannot reach secrets through a barrel or a dynamic import", () => {
  const files = { "features/fiscal/view.tsx": '"use client"; import("./bridge")', "features/fiscal/bridge.ts": 'export * from "@/server/session"', "server/session.ts": 'import "server-only"; export const value = 1' };
  assert.match(check(files).join("\n"), /Cliente alcança código de servidor/);
  files["features/fiscal/bridge.ts"] = 'import type { Session } from "@/server/session"; export type { Session }';
  assert.deepEqual(check(files), []);
});

test("server components may compose clients, but not the reverse", () => {
  assert.deepEqual(check({ "app/page.tsx": 'import { value } from "@/server/session"; import "@/features/fiscal/view"', "server/session.ts": 'import "server-only"; export const value = 1', "features/fiscal/view.tsx": '"use client"; export const View = () => null' }), []);
});

test("shared utilities, basic UI and retired locations have enforced boundaries", () => {
  const errors = check({ "lib/erp-session.ts": "", "lib/helper.ts": 'import "@/features/fiscal/view"', "components/ui/button.tsx": 'import "@/features/fiscal/view"', "features/fiscal/view.tsx": 'import "@/app/page"', "app/page.tsx": "" });
  for (const rule of [/Local retirado/, /lib depende/, /UI básica depende/, /Funcionalidade depende/]) assert.match(errors.join("\n"), rule);
});

test("new ownership, missing server markers and transitive node imports fail", () => {
  const errors = check({ "features/misc/view.tsx": '"use client"; import "@/lib/helper"', "lib/helper.ts": 'import { readFile } from "node:fs"', "server/session.ts": "export const value = 1" });
  for (const rule of [/Domínio sem responsabilidade/, /sem server-only/, /Cliente alcança/]) assert.match(errors.join("\n"), rule);
});

test("route identity is independent of listing order and detects removed URLs", () => {
  const names = [prefix + "app/fiscal/page.tsx", prefix + "app/api/erp/fiscal/route.ts"];
  assert.deepEqual(routeSurface(names), routeSurface([...names].reverse()));
  const rules = { ...policy, routeSurface: routeSurface(names) };
  assert.deepEqual(validateStructure(new Map(names.map(name => [name, ""])), rules), []);
  assert.match(validateStructure(new Map([[names[0], ""]]), rules).join("\n"), /superfície de rotas mudou/);
});
