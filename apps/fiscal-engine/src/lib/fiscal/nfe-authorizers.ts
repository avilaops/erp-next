import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type NfeEnvironment = "homologacao" | "producao";
export type NfeService = "autorizacao" | "retornoAutorizacao" | "consulta" | "eventos" | "inutilizacao" | "status" | "cadastro";
type RouteMode = "normal" | "contingencia";
type PublishedAddress = { version: string; url: string };
type MatrixEnvironment = {
  source: string; sourceSha256: string;
  routing: Record<string, { normal: string; cadastro: string | null; contingencia: string }>;
  authorizers: Record<string, Record<string, PublishedAddress>>;
};
type Matrix = { schemaVersion: string; checkedAt: string; environments: Record<NfeEnvironment, MatrixEnvironment> };
const MATRIX_SHA256 = "95b3757d101ffe48144102d9428a9f53d1d3d60116ccf131bc260028e76dfdef";
const names: Record<NfeService, string> = {
  autorizacao: "NFeAutorizacao", retornoAutorizacao: "NFeRetAutorizacao", consulta: "NfeConsultaProtocolo",
  eventos: "RecepcaoEvento", inutilizacao: "NfeInutilizacao", status: "NfeStatusServico", cadastro: "NfeConsultaCadastro",
};

export class NfeRoutingError extends Error {}

/** Returns a new copy on each read; callers cannot mutate a shared routing policy. */
export function readNfeAuthorizerMatrix(read = () => readFileSync(new URL("./schemas/nfe-authorizers/matrix.json", import.meta.url), "utf8")): Matrix {
  try {
    const raw = read();
    if (createHash("sha256").update(raw, "utf8").digest("hex") !== MATRIX_SHA256) throw new Error();
    const matrix = JSON.parse(raw) as Matrix;
    if (matrix.schemaVersion !== "nfe-authorizers/1") throw new Error();
    return matrix;
  } catch { throw new NfeRoutingError("Matriz de serviços NF-e indisponível."); }
}

/** Published metadata only. Neither a listed address nor a mode enables transport. */
export function publishedNfeService(issuerUf: string, environment: NfeEnvironment, service: NfeService, mode: RouteMode = "normal") {
  if (typeof issuerUf !== "string" || !/^[A-Z]{2}$/.test(issuerUf)
    || typeof environment !== "string" || !["homologacao", "producao"].includes(environment)
    || typeof service !== "string" || !Object.hasOwn(names, service)
    || typeof mode !== "string" || !["normal", "contingencia"].includes(mode)) throw new NfeRoutingError("UF, ambiente, serviço ou modo NF-e inválido.");
  const matrix = readNfeAuthorizerMatrix(), source = matrix.environments[environment];
  if (!Object.hasOwn(source.routing, issuerUf)) throw new NfeRoutingError("UF do emitente não consta da matriz NF-e.");
  const route = source.routing[issuerUf];
  const authorizer = mode === "contingencia" ? route.contingencia : service === "cadastro" ? route.cadastro : route.normal;
  if (!authorizer) return null;
  const address = source.authorizers[authorizer][names[service]];
  if (!address) return null;
  return {
    issuerUf, environment, service, mode, authorizer, serviceVersion: address.version,
    url: address.url, addressKind: new URL(address.url).search === "?wsdl" ? "wsdl" as const : "service" as const,
    source: source.source, sourceSha256: source.sourceSha256, checkedAt: matrix.checkedAt,
  };
}

/** Preserve the existing SP resolvers. Production dispatch remains blocked in the engine. */
export function configuredNfeServiceUrl(issuerUf: string, environment: NfeEnvironment, service: NfeService, mode: RouteMode = "normal"): string {
  if (mode !== "normal") throw new NfeRoutingError("Fluxo de contingência NF-e ainda não implementado nem habilitado.");
  if (issuerUf !== "SP") throw new NfeRoutingError("UF ainda não habilitada para transporte: só São Paulo permanece configurado.");
  if (!["autorizacao", "consulta", "eventos", "inutilizacao"].includes(service)) throw new NfeRoutingError("Serviço NF-e ainda não implementado no transporte atual.");
  const address = publishedNfeService(issuerUf, environment, service);
  if (!address || address.addressKind !== "service") throw new NfeRoutingError("Endereço de transporte NF-e ainda não conferido.");
  return address.url;
}
