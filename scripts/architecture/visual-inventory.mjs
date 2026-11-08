import { readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const app = path.join(root, "apps/web/src/app");
const output = path.join(root, "artifacts/ui-audit");

async function pages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(entry => entry.isDirectory()
    ? pages(path.join(directory, entry.name))
    : entry.name === "page.tsx" ? [path.join(directory, entry.name)] : []));
  return children.flat();
}

const routes = (await pages(app)).map(file => {
  const relative = path.relative(app, path.dirname(file)).replaceAll("\\", "/");
  const route = "/" + relative.split("/").filter(segment => segment && !segment.startsWith("(")).join("/");
  return {
    route,
    source: path.relative(root, file).replaceAll("\\", "/"),
    requiresRecord: route.includes("["),
    captures: { desktop: null, mobile: null },
    review: "pending",
  };
}).sort((left, right) => left.route.localeCompare(right.route));

await mkdir(output, { recursive: true });
await writeFile(path.join(output, "inventory.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  viewports: { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } },
  routes,
}, null, 2) + "\n");
console.log(JSON.stringify({ pages: routes.length, static: routes.filter(route => !route.requiresRecord).length, dynamic: routes.filter(route => route.requiresRecord).length, output }));
