import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import manifest from "./schemas/nfse-national/manifest.json" with { type: "json" };

export class NationalNfseXmlError extends Error {
  code: "invalid" | "unavailable";
  constructor(code: "invalid" | "unavailable", message: string) { super(message); this.code = code; }
}
type SchemaFile = { fileName: string; contents: string };
export type NationalNfseLayoutVerification = { layout: "official_schema_valid" | "local_profile_valid"; correction: string | null };
const unavailable = () => new NationalNfseXmlError("unavailable", "Conferência local do schema de NFS-e nacional indisponível.");

export async function readNationalNfseSchemas(version: string, read?: (name: string) => Promise<string>): Promise<{ entry: string; files: SchemaFile[] }> {
  if (!Object.hasOwn(manifest.versions, version)) throw new NationalNfseXmlError("invalid", "Versão de NFS-e nacional não suportada.");
  const pack = manifest.versions[version as keyof typeof manifest.versions];
  try {
    const files = await Promise.all(pack.files.map(async ({ name, sha256 }) => {
      if (!/^[A-Za-z0-9_.-]+\.xsd$/.test(name)) throw unavailable();
      const contents = await (read ? read(name) : readFile(new URL(`./schemas/nfse-national/${version}/${name}`, import.meta.url), "utf8"));
      if (createHash("sha256").update(contents, "utf8").digest("hex") !== sha256) throw unavailable();
      return { fileName: name, contents };
    }));
    const names = new Set(files.map(file => file.fileName));
    if (!names.has(pack.entry)) throw unavailable();
    for (const file of files) for (const match of file.contents.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) if (!names.has(match[1])) throw unavailable();
    return { entry: pack.entry, files };
  } catch { throw unavailable(); }
}

let active = 0;
/** Only layout validity is established here; XMLDSig cryptographic verification is separate. */
export async function assertNationalNfseLayout(xml: string, version: string): Promise<NationalNfseLayoutVerification> {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > 1_048_576 || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new NationalNfseXmlError("invalid", "XML de NFS-e inválido ou acima do limite de 1 MiB.");
  if (active >= 4) throw unavailable();
  active++;
  try {
    const pack = await readNationalNfseSchemas(version);
    const correction = version === "1.01" ? manifest.localProfiles["1.01"] : null;
    if (correction) {
      // Preserve the downloaded XSD. Apply only this documented, exact-hash
      // local profile; never reinterpret regexes or relax an unknown schema.
      if (correction.id !== "nfse-1.01-dps-series-regex-v1" || correction.version !== version || correction.file !== "tiposSimples_v1.01.xsd") throw unavailable();
      let changed = 0;
      pack.files = pack.files.map(file => {
        if (file.fileName !== correction.file) return file;
        if (createHash("sha256").update(file.contents).digest("hex") !== correction.originalSha256 || file.contents.split(correction.before).length !== 2) throw unavailable();
        const contents = file.contents.replace(correction.before, correction.after);
        if (createHash("sha256").update(contents).digest("hex") !== correction.derivedSha256) throw unavailable();
        changed++;
        return { ...file, contents };
      });
      if (changed !== 1) throw unavailable();
    }
    const entry = pack.files.find(file => file.fileName === pack.entry);
    if (!entry) throw unavailable();
    const { validateXML } = await import("xmllint-wasm");
    const result = await validateXML({ xml: [{ fileName: "nfse.xml", contents: xml }], schema: [entry], preload: pack.files.filter(file => file.fileName !== entry.fileName), initialMemoryPages: 256, maxMemoryPages: 1024, modifyArguments: args => ["--nonet", ...args] });
    if (result.valid === false) throw new NationalNfseXmlError("invalid", "XML não passou no leiaute oficial de NFS-e nacional.");
    if (result.valid !== true) throw unavailable();
    return { layout: correction ? "local_profile_valid" : "official_schema_valid", correction: correction?.id ?? null };
  } catch (error) { if (error instanceof NationalNfseXmlError) throw error; throw unavailable(); }
  finally { active--; }
}
