import { accessKeyDigit, buildNfeXml } from "@/lib/fiscal/nfe";
import { signNfeXml } from "@/lib/fiscal/sign";
import type { SigningKey } from "@/lib/fiscal/sign";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";

/** Synthetic model 65 for protocol tests only; the production builder remains model 55. */
export function qrInvoice(key: SigningKey, {
  emission = "1", environment = "homologacao", recipient = "cnpj", amount = "60.90",
  issuedAt = "2026-10-02T23:30:00-03:00", change = (xml: string) => xml,
}: {
  emission?: string; environment?: "homologacao" | "producao";
  recipient?: "cnpj" | "cpf" | "foreign" | "anonymous" | "alphanumeric";
  amount?: string; issuedAt?: string; change?: (xml: string) => string;
} = {}): { xml: string; accessKey: string } {
  const built = buildNfeXml({ ...layoutInvoice(), environment, issuedAt });
  const partial = built.key.slice(0, 20) + "65" + built.key.slice(22, 34) + emission + built.key.slice(35, 43);
  const accessKey = partial + accessKeyDigit(partial);
  let xml = built.xml.replaceAll(built.key, accessKey).replace("<mod>55</mod>", "<mod>65</mod>")
    .replace("<tpImp>1</tpImp>", "<tpImp>4</tpImp>").replace("<tpEmis>1</tpEmis>", `<tpEmis>${emission}</tpEmis>`)
    .replace(/<cDV>\d<\/cDV>/, `<cDV>${accessKey[43]}</cDV>`).replace(/<vNF>[^<]+<\/vNF>/, `<vNF>${amount}</vNF>`);
  if (emission === "9") xml = xml.replace("</ide>", `<dhCont>${issuedAt}</dhCont><xJust>Contingência fictícia para teste de protocolo</xJust></ide>`);
  if (recipient === "anonymous") xml = xml.replace(/<dest>[\s\S]*?<\/dest>/, "");
  if (recipient === "cpf") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<CPF>52998224725</CPF>");
  if (recipient === "alphanumeric") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<CNPJ>12ABC34501DE35</CNPJ>");
  if (recipient === "foreign") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<idEstrangeiro>TESTE-EXTERIOR</idEstrangeiro>");
  return { xml: signNfeXml(change(xml), key), accessKey };
}
