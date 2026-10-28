import { mkdir, cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2];
if (!destination || path.resolve(destination) === path.resolve(root)) throw new Error("Choose an independent checkout");
try { await access(destination); throw new Error("Destination already exists; refusing to merge unrelated work"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(destination, { recursive: true });
const allowed = [
  "package.json", "package-lock.json", "tsconfig.json", "README.md", "API.md",
  "DEPLOYMENT.md", "LICENSE-PENDING.md", ".gitignore", ".dockerignore",
  "Dockerfile", "compose.yaml", "src", "test", "examples",
  "dashboard/package.json", "dashboard/package-lock.json", "dashboard/tsconfig.json",
  "dashboard/build.mjs", "dashboard/src", "dashboard/content", "dashboard/test",
  "dashboard/evidence", "dashboard/evidence.allowlist.json",
  "scripts/select-evidence.mjs", "scripts/ui-check.mjs",
];
for (const relative of allowed) {
  await mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
  await cp(path.join(root, relative), path.join(destination, relative), { recursive: true, errorOnExist: true, force: false });
}
console.log("Independent source prepared: " + destination);
