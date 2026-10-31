import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { XMLLintOptions, XMLValidationResult } from "xmllint-wasm";
import manifest from "./schemas/manifest.json" with { type: "json" };

export type FiscalXmlKind = keyof typeof manifest.packages;
type SchemaFile = { fileName: string; contents: string };
export type FiscalSchemaBundle = { release: string; entry: string; files: SchemaFile[] };
type SchemaReader = (relative: string) => Promise<string>;
type Validator = (options: XMLLintOptions) => Promise<XMLValidationResult>;

/** Both failures block transmission; neither is a rejection from SEFAZ. */
export class FiscalXmlError extends Error {
  readonly reason: "invalid" | "unavailable";

  constructor(reason: "invalid" | "unavailable", message: string) {
    super(message);
    this.name = "FiscalXmlError";
    this.reason = reason;
  }
}

const unavailable = () => new FiscalXmlError("unavailable", "A conferência local do XML está indisponível. Nada foi transmitido. Tente novamente; se continuar, peça à equipe para conferir o validador e o pacote de schemas.");
const SCHEMAS = join(process.cwd(), "src/lib/fiscal/schemas");
const MAX_XML_BYTES = 1_048_576;
const ROOTS: Record<FiscalXmlKind, string> = { nfe: "NFe", evento: "evento", inutilizacao: "inutNFe" };

/** Fixed, versioned files only. No location from the invoice chooses a file. */
export async function readFiscalSchemas(kind: FiscalXmlKind, read: SchemaReader = (relative) => readFile(join(SCHEMAS, relative), "utf8")): Promise<FiscalSchemaBundle> {
  try {
    const pack = manifest.packages[kind];
    if (!pack) throw unavailable();
    const files = await Promise.all(pack.files.map(async ({ name, sha256 }) => {
      if (!/^[a-zA-Z0-9_.-]+\.xsd$/.test(name)) throw unavailable();
      const contents = await read(`${kind}/${name}`);
      if (createHash("sha256").update(contents, "utf8").digest("hex") !== sha256) throw unavailable();
      return { fileName: name, contents };
    }));
    const names = new Set(files.map((file) => file.fileName));
    if (!names.has(pack.entry)) throw unavailable();
    for (const file of files) {
      for (const match of file.contents.matchAll(/schemaLocation\s*=\s*["']([^"']+)["']/g)) {
        if (!names.has(match[1])) throw unavailable();
      }
    }
    return { release: pack.release, entry: pack.entry, files };
  } catch {
    throw unavailable();
  }
}

/** Factored dependencies let tests simulate missing WASM/schemas without disabling the live check. */
export function createFiscalXmlValidator(
  load: (kind: FiscalXmlKind) => Promise<FiscalSchemaBundle> = readFiscalSchemas,
  validate: Validator = async (options) => (await import("xmllint-wasm")).validateXML(options),
) {
  const bundles = new Map<FiscalXmlKind, Promise<FiscalSchemaBundle>>();
  let active = 0;
  return async (xml: string, kind: FiscalXmlKind): Promise<void> => {
    if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES || xml.includes("\0") || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
      throw new FiscalXmlError("invalid", "XML fiscal recusado: tamanho máximo de 1 MiB; DTD, entidades e caracteres nulos não são permitidos. Nada foi transmitido.");
    }
    const body = xml.replace(/^\s*<\?xml\b[^?]*\?>\s*/, "").trim();
    const root = /^<([A-Za-z][A-Za-z0-9]*)\b/.exec(body)?.[1];
    if (root !== ROOTS[kind] || !/<Signature\b/.test(body)) throw new FiscalXmlError("invalid", "O XML fiscal não é o documento assinado esperado. Nada foi transmitido.");
    // Each validation starts an isolated worker with a bounded WASM heap.
    if (active >= 4) throw new FiscalXmlError("unavailable", "A conferência local está ocupada. Aguarde alguns instantes e tente novamente. Nada foi transmitido.");
    active += 1;
    try {
      let pending = bundles.get(kind);
      if (!pending) {
        pending = load(kind);
        bundles.set(kind, pending);
      }
      let pack: FiscalSchemaBundle;
      try {
        pack = await pending;
      } catch {
        bundles.delete(kind);
        throw unavailable();
      }
      const entry = pack.files.find((file) => file.fileName === pack.entry);
      if (!entry) throw unavailable();
      const document = kind === "evento" ? `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>${body}</envEvento>` : xml;
      const result = await validate({
        xml: [{ fileName: "documento.xml", contents: document }],
        schema: [entry],
        preload: pack.files.filter((file) => file.fileName !== pack.entry),
        initialMemoryPages: 256,
        maxMemoryPages: 1024,
        modifyArguments: (args) => ["--nonet", ...args],
      });
      if (result.valid === false) {
        const problems = result.errors.slice(0, 5).map((error) => error.message.replace(/\s+/g, " ").slice(0, 250));
        throw new FiscalXmlError("invalid", `O XML não passou na conferência local do leiaute (${pack.release}). Nada foi transmitido. ${problems.join(" · ")}`);
      }
      if (result.valid !== true) throw unavailable();
    } catch (error) {
      if (error instanceof FiscalXmlError) throw error;
      // libxml2 uses exit 1 for malformed XML; package/worker faults use other failures.
      if (error instanceof Error && (error as Error & { code?: unknown }).code === 1 && /documento\.xml:\d+:.*parser error/.test(error.message)) {
        throw new FiscalXmlError("invalid", "O XML fiscal não está bem formado. Nada foi transmitido. Confira a estrutura do documento.");
      }
      throw unavailable();
    } finally {
      active -= 1;
    }
  };
}

export const assertFiscalXml = createFiscalXmlValidator();
