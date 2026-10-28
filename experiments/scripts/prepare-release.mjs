import { mkdir, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
const directory = path.join(homedir(), ".codex", "tmp", "avila-experiments-deploy-20261027");
await mkdir(directory, { recursive: true, mode: 0o700 });
try { await access(path.join(directory, "credentials.json")); console.log("Existing deployment credentials preserved: " + directory); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  const credentials = { username: "laboratorio", password: randomBytes(24).toString("base64url"), token: randomBytes(32).toString("base64url") };
  await writeFile(path.join(directory, "credentials.json"), JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
  await writeFile(path.join(directory, ".env"), "LAB_API_TOKEN=" + credentials.token + "\nDASHBOARD_USER=" + credentials.username + "\nDASHBOARD_PASSWORD=" + credentials.password + "\n", { mode: 0o600, flag: "wx" });
  console.log("Deployment credentials generated privately: " + directory);
}
