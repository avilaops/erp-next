import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CteDistributionError } from "./cte-distribution.ts";
import manifest from "./schemas/cte-distribution/manifest.json" with { type: "json" };

type SchemaFile = { fileName: string; contents: string };
type SchemaReader = (name: string) => Promise<string>;
type DistributionXmlKind = keyof typeof manifest.entries;
const unavailable = () => new CteDistributionError("Conferência local do schema de distribuição CT-e indisponível.");
const readSchema: SchemaReader = (name) => readFile(new URL(`./schemas/cte-distribution/${name}`, import.meta.url), "utf8");

/** Fixed local files only; the schema label in docZip never selects a file. */
export async function readCteDistributionSchemas(read: SchemaReader = readSchema): Promise<SchemaFile[]> {
  try {
    const files = await Promise.all(manifest.files.map(async ({ name, sha256 }) => {
      if (!/^[A-Za-z0-9_.-]+\.xsd$/.test(name)) throw unavailable();
      const contents = await read(name);
      if (createHash("sha256").update(contents, "utf8").digest("hex") !== sha256) throw unavailable();
      return { fileName: name, contents };
    }));
    const names = new Set(files.map(({ fileName }) => fileName));
    if (Object.values(manifest.entries).some((name) => !names.has(name))) throw unavailable();
    for (const { contents } of files) {
      for (const match of contents.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) {
        if (!names.has(match[1])) throw unavailable();
      }
    }
    return files;
  } catch {
    throw unavailable();
  }
}

let active = 0;

/** Validates distribution envelopes, not the signature or layout of each CT-e. */
export async function assertCteDistributionXml(xml: string, kind: DistributionXmlKind): Promise<void> {
  const limit = kind === "request" ? 10_240 : 8_388_608;
  if (!Object.hasOwn(manifest.entries, kind) || typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > limit || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new CteDistributionError("XML de distribuição CT-e inválido ou acima do limite.");
  if (active >= 4) throw unavailable();
  active++;
  try {
    const files = await readCteDistributionSchemas();
    const entry = files.find(({ fileName }) => fileName === manifest.entries[kind]);
    if (!entry) throw unavailable();
    const { validateXML } = await import("xmllint-wasm");
    const result = await validateXML({
      xml: [{ fileName: "distribuicao-cte.xml", contents: xml }],
      schema: [entry],
      preload: files.filter(({ fileName }) => fileName !== entry.fileName),
      initialMemoryPages: 256,
      maxMemoryPages: 1024,
      modifyArguments: (args) => ["--nonet", ...args],
    });
    if (result.valid === false) throw new CteDistributionError("XML não passou no leiaute oficial de distribuição CT-e.");
    if (result.valid !== true) throw unavailable();
  } catch (error) {
    if (error instanceof CteDistributionError) throw error;
    throw unavailable();
  } finally {
    active--;
  }
}
