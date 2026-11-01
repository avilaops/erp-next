import { ACCESS_KEY_PATTERN, NfeError, UF_CODES } from "@/lib/fiscal/nfe";
import { SefazError } from "@/lib/fiscal/sefaz";

/**
 * The events of an authorised NF-e the company itself registers: cancellation
 * (110111) and correction letter (110110), web service NFeRecepcaoEvento4.
 * Pure: the XML that goes, the envelope and the reading of the answer.
 */

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
const WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";
export const EVENT_ACTION = `${WSDL}/nfeRecepcaoEvento`;

const EVENT_URLS: Record<string, { homologacao: string; producao: string }> = {
  SP: {
    homologacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
    producao: "https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
  },
};

export function eventUrl(uf: string, environment: "homologacao" | "producao"): string {
  const urls = EVENT_URLS[uf];
  if (!urls) throw new SefazError(`Cancelamento e carta de correção ainda não estão configurados para empresas de ${uf || "estado não informado"}: só São Paulo.`);
  return urls[environment];
}

/** The text the layout demands, word for word, in every correction letter. */
const CONDITIONS =
  "A Carta de Correção é disciplinada pelo § 1º-A do art. 7º do Convênio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularização de erro ocorrido na emissão de documento fiscal, desde que o erro não esteja relacionado com: I - as variáveis que determinam o valor do imposto tais como: base de cálculo, alíquota, diferença de preço, quantidade, valor da operação ou da prestação; II - a correção de dados cadastrais que implique mudança do remetente ou do destinatário; III - a data de emissão ou de saída.";

export type NfeEvent = {
  kind: "cancelamento" | "correcao";
  environment: "homologacao" | "producao";
  /** The access key of the invoice the event is about. */
  accessKey: string;
  /** CNPJ of who issued the invoice. */
  cnpj: string;
  /** `AAAA-MM-DDTHH:MM:SS-03:00`. */
  at: string;
  /** 1 for a cancellation; the correction letters of an invoice count 1, 2, 3… and the last one is the one that holds. */
  sequence: number;
  /** The protocol of authorisation of the invoice: a cancellation names it. */
  protocol?: string;
  /** The reason of the cancellation, or the text of the correction: at least 15 letters. */
  text: string;
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Normalizes and validates the human text before the event enters the durable queue. */
export function eventText(kind: NfeEvent["kind"], value: string): string {
  const text = clean(value);
  const limit = kind === "cancelamento" ? 255 : 1000;
  if (text.length < 15) throw new NfeError(kind === "cancelamento" ? "Escreva o motivo do cancelamento com pelo menos 15 letras." : "Escreva a correção com pelo menos 15 letras.");
  if (text.length > limit) throw new NfeError(`O texto passa de ${limit} letras.`);
  return text;
}

/** The event, not signed. Throws `NfeError` with what the user has to fix. */
export function eventXml(event: NfeEvent): { id: string; xml: string } {
  if (!ACCESS_KEY_PATTERN.test(event.accessKey)) throw new Error("Chave de acesso inválida.");
  const text = eventText(event.kind, event.text);
  if (!Number.isInteger(event.sequence) || event.sequence < 1 || event.sequence > 20) throw new NfeError("Uma nota aceita até 20 cartas de correção.");
  if (event.kind === "cancelamento" && !/^\d{15}$/.test(event.protocol ?? "")) throw new Error("O cancelamento precisa do protocolo de autorização da nota.");

  const type = event.kind === "cancelamento" ? "110111" : "110110";
  const id = `ID${type}${event.accessKey}${String(event.sequence).padStart(2, "0")}`;
  const detail =
    event.kind === "cancelamento"
      ? `<descEvento>Cancelamento</descEvento><nProt>${event.protocol}</nProt><xJust>${escape(text)}</xJust>`
      : `<descEvento>Carta de Correção</descEvento><xCorrecao>${escape(text)}</xCorrecao><xCondUso>${CONDITIONS}</xCondUso>`;
  const xml =
    `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${id}">` +
    `<cOrgao>${event.accessKey.slice(0, 2)}</cOrgao><tpAmb>${event.environment === "producao" ? "1" : "2"}</tpAmb><CNPJ>${event.cnpj}</CNPJ><chNFe>${event.accessKey}</chNFe>` +
    `<dhEvento>${event.at}</dhEvento><tpEvento>${type}</tpEvento><nSeqEvento>${event.sequence}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${detail}</detEvento></infEvento></evento>`;
  if (!Object.values(UF_CODES).includes(event.accessKey.slice(0, 2))) throw new Error("Chave de acesso de estado desconhecido.");
  return { id, xml };
}

/** The SOAP 1.2 envelope with one signed event. */
export function eventEnvelope(signedEvent: string, batch: string): string {
  if (!/^\d{1,15}$/.test(batch)) throw new Error("O número do lote tem de 1 a 15 dígitos.");
  if (!signedEvent.startsWith(`<evento xmlns="${NFE_NS}"`) || !signedEvent.includes("<Signature ")) throw new Error("Só um evento assinado vai para a SEFAZ.");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${WSDL}"><envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${batch}</idLote>${signedEvent}</envEvento></nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`
  );
}

export type EventResult = { registered: true; code: string; reason: string; protocol: string } | { registered: false; code: string; reason: string };

const pick = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml)?.[1] ?? null;
const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
/** Only a linked event changes the invoice. 136 is registered without linkage. */
const REGISTERED = new Set(["135", "155"]);

/** Reads the answer about the event of `accessKey`. Anything that is not an answer of SEFAZ throws. */
export function parseEvent(response: string, accessKey: string): EventResult {
  const batch = /<retEnvEvento[\s\S]*<\/retEnvEvento>/.exec(response)?.[0];
  if (!batch) {
    const fault = pick(response, "Text") ?? pick(response, "faultstring");
    throw new SefazError(fault ? `A SEFAZ recusou a chamada: ${unescape(fault)}` : "A resposta da SEFAZ não é a esperada. Tente de novo em instantes.");
  }
  const result = /<retEvento[\s\S]*?<\/retEvento>/.exec(batch)?.[0];
  if (!result) return { registered: false, code: pick(batch, "cStat") ?? "", reason: unescape(pick(batch, "xMotivo") ?? "") };
  if ((pick(result, "chNFe") ?? accessKey) !== accessKey) throw new SefazError("A SEFAZ respondeu sobre outra nota. Nada foi gravado.");
  const code = pick(result, "cStat") ?? "";
  const reason = unescape(pick(result, "xMotivo") ?? "");
  const protocol = pick(result, "nProt");
  return REGISTERED.has(code) && protocol ? { registered: true, code, reason, protocol } : { registered: false, code, reason };
}

/** Distributable event: the signed request and the authority's actual receipt. */
export function processedEventXml(signed: string, response: string): string {
  const accessKey = pick(signed, "chNFe");
  if (!accessKey || !ACCESS_KEY_PATTERN.test(accessKey)) throw new SefazError("Evento assinado sem chave válida.");
  const result = parseEvent(response, accessKey);
  if (!result.registered) throw new SefazError("O evento não foi vinculado à nota pela SEFAZ.");
  if (pick(signed, "tpEvento") === "110110" && result.code !== "135") throw new SefazError("A SEFAZ não confirmou a carta de correção vinculada à nota.");
  const receipt = /<retEvento\b[\s\S]*?<\/retEvento>/.exec(response)?.[0];
  if (!receipt) throw new SefazError("A SEFAZ não devolveu o recibo do evento.");
  for (const field of ["tpAmb", "chNFe", "tpEvento", "nSeqEvento"]) {
    if (pick(receipt, field) !== pick(signed, field)) throw new SefazError("O recibo da SEFAZ não corresponde ao evento enviado. Confira a situação antes de tentar novamente.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NFE_NS}" versao="1.00">${signed.replace(/^<\?xml[^?]*\?>\s*/, "")}${receipt}</procEventoNFe>`;
}
