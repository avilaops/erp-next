import { request } from "node:https";
import { ACCESS_KEY_PATTERN, CNPJ_PATTERN } from "@/lib/fiscal/nfe";

/**
 * The conversation with SEFAZ for authorising an NF-e (web service
 * NFeAutorizacao4, synchronous, one invoice per batch): the envelope that goes,
 * the reading of what comes back and the file that is kept. The pure parts
 * (envelope, parsing, nfeProc) know nothing of network; `transmit` is the only
 * thing here that talks to anyone.
 */

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4";

/** A refusal the company can read: the message goes to the screen as it is. */
export class SefazError extends Error {}

/**
 * Where each state authorises. Only what was checked against the published
 * list is here: a state that is missing is an error, never a guess.
 */
const AUTHORIZATION_URLS: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
    producao: "https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
  },
};

export function authorizationUrl(uf: string, environment: "homologacao" | "producao"): string {
  const urls = AUTHORIZATION_URLS[uf];
  if (!urls) throw new SefazError(`A emissão ainda não está configurada para empresas de ${uf || "estado não informado"}: só São Paulo.`);
  return urls[environment];
}

export const AUTHORIZATION_ACTION = `${WSDL}/nfeAutorizacaoLote`;

/** The SOAP 1.2 envelope with one signed invoice, asking for the answer in the same call. */
export function authorizationEnvelope(signedXml: string, batch: string): string {
  if (!/^\d{1,15}$/.test(batch)) throw new Error("O número do lote tem de 1 a 15 dígitos.");
  const invoice = signedXml.replace(/^<\?xml[^>]*\?>/, "");
  if (!invoice.startsWith(`<NFe xmlns="${NFE_NS}">`) || !invoice.includes("<Signature ")) throw new Error("Só uma nota assinada vai para a SEFAZ.");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${WSDL}"><enviNFe xmlns="${NFE_NS}" versao="4.00"><idLote>${batch}</idLote><indSinc>1</indSinc>${invoice}</enviNFe></nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`
  );
}

export type AuthorizationResult =
  | { status: "autorizada"; code: string; reason: string; protocol: string; protocolXml: string }
  | { status: "rejeitada"; code: string; reason: string }
  /** Denied for a fiscal irregularity of who issues or receives: the number is spent. */
  | { status: "denegada"; code: string; reason: string; protocol: string; protocolXml: string }
  /** SEFAZ answered, but not with a verdict on the invoice (service stopped, batch still being processed…). */
  | { status: "sem-resposta"; code: string; reason: string };

const pick = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;
const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Authorised: 100, 150 (outside the deadline) and 120 (with an alert, NT
 * 2026.002: today only the NFC-e gets it, and an invoice that comes back with
 * it is as authorised as any other). Denied: 110, 301, 302, 303.
 */
const AUTHORIZED = new Set(["100", "120", "150"]);
const DENIED = new Set(["110", "301", "302", "303"]);
/**
 * Refusals of the call, not of the invoice: SEFAZ did not look at it. 656 is
 * "consumo indevido" (MOC 7.0, Anexo I, 4.3): the same invoice is sent again
 * later, and correcting it would only add to the count that caused the block.
 */
const NOT_A_VERDICT = new Set(["656"]);
/**
 * Rejections that say the number already belongs to another invoice at SEFAZ
 * (rules 2B08-10, 2B08-30, 2B08-40 and 3B08-100): another key, cancelled,
 * denied or made unusable. An invoice rejected with one of them is never
 * issued again with that number. 204 (the same invoice, duplicated) is not
 * here: it is settled by consulting the key, not by a new number.
 */
export const NUMBER_TAKEN = new Set(["205", "206", "218", "539"]);

/**
 * Reads the answer of the authorisation for the invoice of `accessKey`. The
 * verdict is the one inside the protocol of that key; an answer without it is
 * a rejection of the batch, or no answer at all. Anything that is not an
 * answer of SEFAZ throws.
 */
export function parseAuthorization(response: string, accessKey: string): AuthorizationResult {
  const batch = /<retEnviNFe[\s\S]*<\/retEnviNFe>/.exec(response)?.[0];
  if (!batch) {
    const fault = pick(response, "Text") ?? pick(response, "faultstring");
    throw new SefazError(fault ? `A SEFAZ recusou a chamada: ${unescape(fault)}` : "A resposta da SEFAZ não é a esperada. Tente de novo em instantes.");
  }
  const protocolXml = /<protNFe[\s\S]*?<\/protNFe>/.exec(batch)?.[0] ?? null;
  if (protocolXml) {
    if (pick(protocolXml, "chNFe") !== accessKey) throw new SefazError("A SEFAZ respondeu sobre outra nota. Nada foi gravado como autorizado.");
    const code = pick(protocolXml, "cStat") ?? "";
    const reason = unescape(pick(protocolXml, "xMotivo") ?? "");
    const protocol = pick(protocolXml, "nProt");
    if (AUTHORIZED.has(code) && protocol) return { status: "autorizada", code, reason, protocol, protocolXml };
    if (DENIED.has(code) && protocol) return { status: "denegada", code, reason, protocol, protocolXml };
    return { status: "rejeitada", code, reason };
  }
  const code = pick(batch, "cStat") ?? "";
  const reason = unescape(pick(batch, "xMotivo") ?? "");
  // 2xx and above at the level of the batch are rejections; 1xx without a protocol is not a verdict yet.
  return Number(code) >= 200 && !NOT_A_VERDICT.has(code) ? { status: "rejeitada", code, reason } : { status: "sem-resposta", code, reason };
}

/** What the company keeps and sends to its customer: the signed invoice with the protocol of SEFAZ. */
export function nfeProcXml(signedXml: string, protocolXml: string): string {
  const invoice = signedXml.replace(/^<\?xml[^>]*\?>/, "");
  // Inside nfeProc the protocol inherits the namespace: a declaration of its own is dropped.
  const protocol = protocolXml.replace(/^<protNFe\s+xmlns="[^"]*"/, "<protNFe");
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NFE_NS}" versao="4.00">${invoice}${protocol}</nfeProc>`;
}

export type Channel = {
  /** The A1 of the company: SEFAZ only talks to who presents it. */
  pfx: Buffer;
  passphrase: string;
  /** Roots to trust besides the system's (ICP-Brasil), PEM. The server's certificate is always checked. */
  ca?: string | Buffer;
  timeoutMs?: number;
};

/**
 * Posts an envelope and answers with the body. The connection presents the
 * company's certificate and checks SEFAZ's: verification is never turned off.
 * The certificate and its password are never part of an error message.
 */
export function transmit(url: string, action: string, envelope: string, channel: Channel): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(envelope, "utf8");
    const call = request(
      url,
      {
        method: "POST",
        pfx: channel.pfx,
        passphrase: channel.passphrase,
        ca: channel.ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        timeout: channel.timeoutMs ?? 30_000,
        headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`, "Content-Length": body.length },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("error", () => reject(new SefazError("Resposta fiscal interrompida; consulte a situação antes de repetir.")));
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 16 * 1024 * 1024) {
            response.destroy();
            reject(new SefazError("Resposta fiscal excedeu o limite; consulte a situação antes de repetir."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          // SOAP faults come with 500 and a body worth reading; anything else without a body is a failure of the channel.
          if (text.trim() === "") reject(new SefazError(`A SEFAZ respondeu sem conteúdo (HTTP ${response.statusCode}). Tente de novo em instantes.`));
          else resolve(text);
        });
      },
    );
    call.on("timeout", () => call.destroy(new SefazError("A SEFAZ não respondeu a tempo. Antes de tentar de novo, confira se a nota não foi autorizada.")));
    call.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof SefazError) return reject(error);
      const tls = /certificate|self.signed|unable to verify|issuer/i.test(error.message);
      reject(new SefazError(tls ? "Não foi possível confirmar a identidade do servidor da SEFAZ (cadeia de certificados). Nada foi enviado." : `Não foi possível falar com a SEFAZ (${error.code ?? "falha de rede"}). Nada foi autorizado.`));
    });
    call.end(body);
  });
}

/* ---------- Consulta de protocolo (NFeConsultaProtocolo4) ---------- */

const CONSULT_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4";
export const CONSULT_ACTION = `${CONSULT_WSDL}/nfeConsultaNF`;
const CONSULT_URLS: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
    producao: "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
  },
};

export function consultUrl(uf: string, environment: "homologacao" | "producao"): string {
  const urls = CONSULT_URLS[uf];
  if (!urls) throw new SefazError(`A consulta ainda não está configurada para empresas de ${uf || "estado não informado"}: só São Paulo.`);
  return urls[environment];
}

/** Asks SEFAZ what it knows about one access key. Nothing to sign: the certificate of the connection identifies who asks. */
export function consultEnvelope(accessKey: string, environment: "homologacao" | "producao"): string {
  if (!ACCESS_KEY_PATTERN.test(accessKey)) throw new Error("Chave de acesso inválida.");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${CONSULT_WSDL}"><consSitNFe xmlns="${NFE_NS}" versao="4.00"><tpAmb>${environment === "producao" ? "1" : "2"}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${accessKey}</chNFe></consSitNFe></nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`
  );
}

export type ConsultResult =
  | { status: "autorizada"; code: string; reason: string; protocol: string; protocolXml: string }
  | { status: "cancelada" | "denegada" | "outra"; code: string; reason: string }
  /** SEFAZ never received this invoice: it is safe to send it. */
  | { status: "nao-consta"; code: string; reason: string };

/** Reads the answer of the consultation of `accessKey`. Cancelled: 101, 151, 155. Not in the base: 217. */
export function parseConsult(response: string, accessKey: string): ConsultResult {
  const body = /<retConsSitNFe[\s\S]*<\/retConsSitNFe>/.exec(response)?.[0];
  if (!body) {
    const fault = pick(response, "Text") ?? pick(response, "faultstring");
    throw new SefazError(fault ? `A SEFAZ recusou a consulta: ${unescape(fault)}` : "A resposta da SEFAZ não é a esperada. Tente de novo em instantes.");
  }
  const withoutProtocol = body.replace(/<protNFe[\s\S]*?<\/protNFe>/, "").replace(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/g, "");
  const code = pick(withoutProtocol, "cStat") ?? "";
  const reason = unescape(pick(withoutProtocol, "xMotivo") ?? "");
  if ((pick(withoutProtocol, "chNFe") ?? accessKey) !== accessKey) throw new SefazError("A SEFAZ respondeu sobre outra nota. Nada foi gravado.");
  const protocolXml = /<protNFe[\s\S]*?<\/protNFe>/.exec(body)?.[0] ?? null;
  if (AUTHORIZED.has(code) && protocolXml && pick(protocolXml, "chNFe") === accessKey) {
    const protocol = pick(protocolXml, "nProt");
    if (protocol) return { status: "autorizada", code, reason, protocol, protocolXml };
  }
  if (["101", "151", "155"].includes(code)) return { status: "cancelada", code, reason };
  if (DENIED.has(code)) return { status: "denegada", code, reason };
  if (code === "217") return { status: "nao-consta", code, reason };
  return { status: "outra", code, reason };
}

export type ConsultedEvent = { kind: "cancelamento" | "correcao"; sequence: number; protocol: string; code: string; text: string; xml: string };

/**
 * The events SEFAZ has for the invoice, out of the answer of the consultation
 * (it brings every `procEventoNFe` linked to the key): the cancellation and the
 * correction letters, each with its own protocol. It is how an event whose
 * answer was lost is found again, instead of being sent twice (rejection 573).
 */
export function consultEvents(response: string, accessKey: string): ConsultedEvent[] {
  const events: ConsultedEvent[] = [];
  for (const [xml] of response.matchAll(/<procEventoNFe[\s\S]*?<\/procEventoNFe>/g)) {
    const sent = /<evento[\s\S]*?<\/evento>/.exec(xml)?.[0] ?? "";
    const answer = /<retEvento[\s\S]*?<\/retEvento>/.exec(xml)?.[0] ?? "";
    const type = pick(sent, "tpEvento");
    const protocol = pick(answer, "nProt");
    const sequence = Number(pick(sent, "nSeqEvento"));
    const code = pick(answer, "cStat") ?? "";
    if (pick(sent, "chNFe") !== accessKey || pick(answer, "chNFe") !== accessKey || !protocol || !Number.isInteger(sequence) || sequence < 1 || sequence > 20 || !["135", "155"].includes(code)) continue;
    if (["tpAmb", "tpEvento", "nSeqEvento"].some((field) => !pick(sent, field) || pick(sent, field) !== pick(answer, field))) continue;
    // The namespace may have been inherited from retConsSitNFe. Keep it in the standalone file.
    const file = /<procEventoNFe\b[^>]*\sxmlns=/.test(xml) ? xml : xml.replace("<procEventoNFe", `<procEventoNFe xmlns="${NFE_NS}"`);
    if (type === "110111" && sequence === 1) events.push({ kind: "cancelamento", sequence, protocol, code, text: unescape(pick(sent, "xJust") ?? ""), xml: file });
    if (type === "110110" && code === "135") events.push({ kind: "correcao", sequence, protocol, code, text: unescape(pick(sent, "xCorrecao") ?? ""), xml: file });
  }
  return events;
}

/* ---------- Inutilização de numeração (NFeInutilizacao4) ---------- */

const VOID_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4";
export const VOID_ACTION = `${VOID_WSDL}/nfeInutilizacaoNF`;
const VOID_URLS: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
    producao: "https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
  },
};

export function voidUrl(uf: string, environment: "homologacao" | "producao"): string {
  const urls = VOID_URLS[uf];
  if (!urls) throw new SefazError(`A inutilização ainda não está configurada para empresas de ${uf || "estado não informado"}: só São Paulo.`);
  return urls[environment];
}

export type NumberVoid = {
  environment: "homologacao" | "producao";
  /** IBGE code of the state of the company, two digits. */
  stateCode: string;
  /** The two last digits of the year. */
  year: string;
  cnpj: string;
  series: number;
  first: number;
  last: number;
  /** Why the numbers were skipped: 15 to 255 letters. */
  reason: string;
};

/** The request that makes a range of numbers unusable, not signed. Throws `SefazError` with what the user has to fix. */
export function voidXml(request: NumberVoid): { id: string; xml: string } {
  const reason = request.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 15 || reason.length > 255) throw new SefazError("Escreva o motivo da inutilização com 15 a 255 letras.");
  const whole = (value: number, max: number) => Number.isInteger(value) && value >= 1 && value <= max;
  if (!whole(request.series, 999)) throw new SefazError("Série: de 1 a 999.");
  if (!whole(request.first, 999_999_999) || !whole(request.last, 999_999_999) || request.last < request.first) throw new SefazError("Informe o primeiro e o último número da faixa, em ordem.");
  if (!/^\d{2}$/.test(request.stateCode) || !/^\d{2}$/.test(request.year) || !CNPJ_PATTERN.test(request.cnpj)) throw new Error("Dados do emitente inválidos para a inutilização.");
  const pad = (value: number, size: number) => String(value).padStart(size, "0");
  const id = `ID${request.stateCode}${request.year}${request.cnpj}55${pad(request.series, 3)}${pad(request.first, 9)}${pad(request.last, 9)}`;
  const text = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xml =
    `<inutNFe xmlns="${NFE_NS}" versao="4.00"><infInut Id="${id}"><tpAmb>${request.environment === "producao" ? "1" : "2"}</tpAmb><xServ>INUTILIZAR</xServ>` +
    `<cUF>${request.stateCode}</cUF><ano>${request.year}</ano><CNPJ>${request.cnpj}</CNPJ><mod>55</mod><serie>${request.series}</serie>` +
    `<nNFIni>${request.first}</nNFIni><nNFFin>${request.last}</nNFFin><xJust>${text}</xJust></infInut></inutNFe>`;
  return { id, xml };
}

export function voidEnvelope(signedRequest: string): string {
  if (!signedRequest.startsWith(`<inutNFe xmlns="${NFE_NS}"`) || !signedRequest.includes("<Signature ")) throw new Error("Só um pedido assinado vai para a SEFAZ.");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${VOID_WSDL}">${signedRequest}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  );
}

/** 102: "Inutilização de número homologado". Anything else is a refusal, with the reason. */
export function parseVoid(response: string): { registered: true; code: string; reason: string; protocol: string } | { registered: false; code: string; reason: string } {
  const body = /<retInutNFe[\s\S]*<\/retInutNFe>/.exec(response)?.[0];
  if (!body) {
    const fault = pick(response, "Text") ?? pick(response, "faultstring");
    throw new SefazError(fault ? `A SEFAZ recusou a chamada: ${unescape(fault)}` : "A resposta da SEFAZ não é a esperada. Tente de novo em instantes.");
  }
  const code = pick(body, "cStat") ?? "";
  const reason = unescape(pick(body, "xMotivo") ?? "");
  const protocol = pick(body, "nProt");
  return code === "102" && protocol ? { registered: true, code, reason, protocol } : { registered: false, code, reason };
}
