import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import manifest from "./schemas/cte-received/manifest.json" with { type: "json" };

export class CteInspectionError extends Error {
  readonly reason: "invalid" | "unavailable" | "unsupported";
  constructor(reason: "invalid" | "unavailable" | "unsupported") {
    super(reason === "unavailable" ? "Conferência local do CT-e indisponível." : reason === "unsupported" ? "Formato do CT-e fora do perfil de conferência disponível." : "XML, assinatura ou correlação do CT-e inválidos.");
    this.name = "CteInspectionError";
    this.reason = reason;
  }
}

type File = { fileName: string; contents: string };
type Reader = (name: string) => Promise<string>;
const unavailable = () => new CteInspectionError("unavailable");
export const CTE_INSPECTION_RELEASE = manifest.release;
export const CTE_MODAL_PROFILES: Readonly<Record<string, { root: string; entry: string }>> = Object.freeze(
  Object.fromEntries(Object.entries(manifest.modals).map(([code, profile]) => [code, Object.freeze({ ...profile })])),
);

/** Fixed, hash-pinned local closure. No path comes from source XML or its docZip label. */
export async function readReceivedCteSchemas(read: Reader = name => readFile(new URL(`./schemas/cte-received/${name}`, import.meta.url), "utf8")): Promise<File[]> {
  try {
    const files = await Promise.all(manifest.files.map(async ({ name, sha256 }) => {
      if (!/^[A-Za-z0-9_.-]+\.xsd$/.test(name)) throw unavailable();
      const contents = await read(name);
      if (createHash("sha256").update(contents, "utf8").digest("hex") !== sha256) throw unavailable();
      return { fileName: name, contents };
    }));
    const names = new Set(files.map(file => file.fileName));
    if (!names.has(manifest.entry) || Object.values(CTE_MODAL_PROFILES).some(profile => !names.has(profile.entry))) throw unavailable();
    for (const file of files) for (const match of file.contents.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) if (!names.has(match[1])) throw unavailable();
    return files;
  } catch { throw unavailable(); }
}

let active = 0;

export async function assertReceivedCteLayout(xml: string, modal: string, modalXml: string | null): Promise<void> {
  const profile = Object.hasOwn(CTE_MODAL_PROFILES, modal) ? CTE_MODAL_PROFILES[modal] : null;
  if (!profile) throw new CteInspectionError("unsupported");
  if ([xml, ...(modalXml === null ? [] : [modalXml])].some(value => typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 2_097_152 || /\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(value))) throw new CteInspectionError("invalid");
  if (active >= 4) throw unavailable();
  active++;
  try {
    const files = await readReceivedCteSchemas();
    const { validateXML } = await import("xmllint-wasm");
    // The document schema explicitly skips modal validation; validate both roots.
    const documents = [[xml, manifest.entry], ...(modalXml === null ? [] : [[modalXml, profile.entry]])];
    for (const [source, name] of documents) {
      const entry = files.find(file => file.fileName === name);
      if (!entry) throw unavailable();
      const result = await validateXML({ xml: [{ fileName: "cte-recebido.xml", contents: source }], schema: [entry], preload: files.filter(file => file.fileName !== name), initialMemoryPages: 256, maxMemoryPages: 1024, modifyArguments: args => ["--nonet", ...args] });
      if (result.valid === false) throw new CteInspectionError("invalid");
      if (result.valid !== true) throw unavailable();
    }
  } catch (error) {
    if (error instanceof CteInspectionError) throw error;
    if (error instanceof Error && (error as Error & { code?: unknown }).code === 1 && /parser error/.test(error.message)) throw new CteInspectionError("invalid");
    throw unavailable();
  } finally { active--; }
}
