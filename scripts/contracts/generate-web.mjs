import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readOpenApi } from "./gate.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("./consumer/package.json", import.meta.url));

export async function generateWeb(input, output = resolve(root, "apps/web/src/lib/api/generated.d.ts")) {
  if (!input) throw new Error("OPENAPI_ARTIFACT_REQUIRED");
  const { document } = await readOpenApi(resolve(input));
  const { default: openapiTS, astToString } = await import(pathToFileURL(require.resolve("openapi-typescript")).href);
  const source = astToString(await openapiTS(document));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, source);
  return source;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await generateWeb(process.argv[2] || resolve(root, "artifacts/contracts/candidate.json"));
}
