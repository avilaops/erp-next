import { ACCESS_KEY_PATTERN, NfeError, UF_CODES } from "@/lib/fiscal/nfe";

const NFE_NS = "http://www.portalfiscal.inf.br/nfe";
export type RecipientManifestKind = "ciencia" | "confirmacao" | "desconhecimento" | "nao_realizada";
const TYPES: Record<RecipientManifestKind, { code: string; description: string }> = {
  ciencia: { code: "210210", description: "Ciencia da Operacao" },
  confirmacao: { code: "210200", description: "Confirmacao da Operacao" },
  desconhecimento: { code: "210220", description: "Desconhecimento da Operacao" },
  nao_realizada: { code: "210240", description: "Operacao nao Realizada" },
};
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function recipientManifestXml(input: { accessKey: string; cnpj: string; environment: "homologacao" | "producao"; at: string; kind: RecipientManifestKind; reason?: string }): { id: string; xml: string } {
  if (!ACCESS_KEY_PATTERN.test(input.accessKey) || !Object.values(UF_CODES).includes(input.accessKey.slice(0, 2))) throw new Error("Chave de acesso inválida.");
  if (!/^[0-9A-Z]{14}$/.test(input.cnpj)) throw new Error("CNPJ inválido.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(input.at)) throw new Error("Data do evento inválida.");
  const event = TYPES[input.kind];
  const reason = input.reason?.replace(/\s+/g, " ").trim() ?? "";
  if (input.kind === "nao_realizada" && (reason.length < 15 || reason.length > 255)) throw new NfeError("Explique a operação não realizada com 15 a 255 letras.");
  const id = `ID${event.code}${input.accessKey}01`;
  const detail = `<descEvento>${event.description}</descEvento>${input.kind === "nao_realizada" ? `<xJust>${escape(reason)}</xJust>` : ""}`;
  const xml = `<evento xmlns="${NFE_NS}" versao="1.00"><infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${input.environment === "producao" ? "1" : "2"}</tpAmb><CNPJ>${input.cnpj}</CNPJ><chNFe>${input.accessKey}</chNFe><dhEvento>${input.at}</dhEvento><tpEvento>${event.code}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00">${detail}</detEvento></infEvento></evento>`;
  return { id, xml };
}
