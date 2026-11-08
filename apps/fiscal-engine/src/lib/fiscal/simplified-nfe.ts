import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { createFiscalQrPayload } from "./nfce-qr.ts";
import type { SigningKey } from "./sign.ts";
import { assertFiscalXml } from "./local-layout.ts";

/** Explicit UF configuration: no NFC-e URL is silently reused for model 55. */
export type SimplifiedNfeEndpoints = { qrCodeUrl: string; accessKeyUrl: string };

function endpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
      !/(^|\.)gov\.br$/.test(url.hostname)) throw new Error("Configure uma URL HTTPS oficial da SEFAZ para NF-e simplificada.");
  return url.href;
}

/** NT 2026.003 v1.00. Signature is checked against the embedded certificate.
 * The supplement is outside infNFe and therefore preserves its XML signature.
 * Offline callers must supply the same key that signed the invoice.
 */
export async function supplementSimplifiedNfe(input: {
  signedXml: string; endpoints: SimplifiedNfeEndpoints; signingKey?: SigningKey;
}): Promise<{ xml: string; qrCodeUrl: string; accessKeyUrl: string; payload: string; accessKey: string }> {
  const qrEndpoint = endpoint(input.endpoints.qrCodeUrl), accessKeyUrl = endpoint(input.endpoints.accessKeyUrl);
  const qr = await createFiscalQrPayload({ signedXml: input.signedXml,
    profile: { version: "3", ...(input.signingKey ? { signingKey: input.signingKey } : {}) } }, "55");
  // The national XSD requires literal separators and literal Base64 in the XML.
  const qrCodeUrl = `${qrEndpoint}?p=${qr.payload}`;
  const doc = new DOMParser().parseFromString(input.signedXml, "application/xml");
  const root = doc.documentElement!;
  const ns = "http://www.portalfiscal.inf.br/nfe";
  const info = root.getElementsByTagNameNS(ns, "infNFe")[0];
  const ide = info.getElementsByTagNameNS(ns, "ide")[0];
  const field = (name: string) => ide.getElementsByTagNameNS(ns, name)[0]?.textContent;
  // NT 2026.002 v1.11: this print mode is restricted to domestic retail sales.
  if (field("finNFe") !== "1" || field("indFinal") !== "1" || field("idDest") !== "1" ||
      field("tpNF") !== "1" || !["1", "4", "5"].includes(field("indPres") ?? "") ||
      ide.getElementsByTagNameNS(ns, "dhSaiEnt").length || ide.getElementsByTagNameNS(ns, "NFref").length) {
    throw new Error("DANFE Simplificado Tipo 2 exige venda interna normal a consumidor final, presença 1, 4 ou 5, sem saída/entrada ou referência fiscal.");
  }
  const descendant = (parent: typeof info, name: string) => parent.getElementsByTagNameNS(ns, name)[0]?.textContent;
  const forbidden = ["IPI", "II", "PISST", "COFINSST", "ICMSUFDest", "cobr", "retirada", "veicTransp", "retTransp", "reboque", "vagao", "balsa", "compra", "cana"];
  if (forbidden.some(name => info.getElementsByTagNameNS(ns, name).length)) {
    throw new Error("DANFE Simplificado Tipo 2 contém grupo tributário, cobrança, retirada ou transporte não permitido.");
  }
  const freight = descendant(info, "modFrete");
  if (freight !== "9" && field("indPres") !== "4") throw new Error("Frete no DANFE Simplificado Tipo 2 exige entrega a domicílio (presença 4).");
  const issuerUf = descendant(info.getElementsByTagNameNS(ns, "emit")[0], "UF");
  const recipient = info.getElementsByTagNameNS(ns, "dest")[0];
  if (recipient && descendant(recipient, "UF") && descendant(recipient, "UF") !== issuerUf) throw new Error("DANFE Simplificado Tipo 2 exige operação interna.");
  const allowed = ["5101", "5102", "5103", "5104", "5115", "5405", "5656", "5667", "5910", "5933"];
  for (const item of Array.from(info.getElementsByTagNameNS(ns, "det"))) {
    const cfop = descendant(item, "CFOP");
    const icms = item.getElementsByTagNameNS(ns, "ICMS")[0];
    const spException = issuerUf === "SP" && cfop === "5949" && icms && descendant(icms, "CST") === "40";
    if (!allowed.includes(cfop ?? "") && !spException) throw new Error("CFOP não permitido no DANFE Simplificado Tipo 2.");
  }
  const amount = descendant(info.getElementsByTagNameNS(ns, "ICMSTot")[0], "vNF");
  const amountParts = amount?.split(".");
  if (!amount || !/^\d+(?:\.\d{2})?$/.test(amount) || !amountParts || BigInt(amountParts[0]) * 100n + BigInt(amountParts[1] ?? "0") > 20_000_000n) {
    throw new Error("Valor total do DANFE Simplificado Tipo 2 excede o limite de R$ 200.000,00.");
  }
  for (const old of Array.from(root.getElementsByTagNameNS(ns, "infNFeSupl"))) old.parentNode!.removeChild(old);
  const supplement = doc.createElementNS(ns, "infNFeSupl");
  for (const [name, value] of [["qrCode", qrCodeUrl], ["urlChave", accessKeyUrl]]) {
    const node = doc.createElementNS(ns, name); node.appendChild(doc.createTextNode(value)); supplement.appendChild(node);
  }
  const signature = root.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
  root.insertBefore(supplement, signature);
  const xml = new XMLSerializer().serializeToString(doc);
  await assertFiscalXml(xml, "nfe");
  return { xml, qrCodeUrl, accessKeyUrl, payload: qr.payload, accessKey: qr.accessKey };
}
