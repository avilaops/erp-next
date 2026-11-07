import { accessKeyDigit, buildNfeXml } from "@/lib/fiscal/nfe";
import { signNfeXml } from "@/lib/fiscal/sign";
import type { SigningKey } from "@/lib/fiscal/sign";
import { layoutInvoice } from "./fiscal-layout-fixture.ts";

/** NFC-e fixture built through the same model 65 production contract. */
export function qrInvoice(key: SigningKey, {
  emission = "1", environment = "homologacao", recipient = "cnpj", amount = "60.90",
  issuedAt = "2026-10-02T23:30:00-03:00", change = (xml: string) => xml,
}: {
  emission?: string; environment?: "homologacao" | "producao";
  recipient?: "cnpj" | "cpf" | "foreign" | "anonymous" | "alphanumeric";
  amount?: string; issuedAt?: string; change?: (xml: string) => string;
} = {}): { xml: string; accessKey: string } {
  const validEmission = (["1", "3", "4", "9"] as const).includes(emission as "1" | "3" | "4" | "9") ? emission as "1" | "3" | "4" | "9" : "1";
  const built = buildNfeXml({ ...layoutInvoice(), model: 65, emissionType: validEmission, environment, issuedAt });
  let accessKey = built.key;
  let xml = built.xml.replace(/<vNF>[^<]+<\/vNF>/, `<vNF>${amount}</vNF>`);
  if (emission !== validEmission) {
    const partial = built.key.slice(0, 34) + emission + built.key.slice(35, 43);
    accessKey = partial + accessKeyDigit(partial);
    xml = xml.replaceAll(built.key, accessKey).replace(`<tpEmis>${validEmission}</tpEmis>`, `<tpEmis>${emission}</tpEmis>`).replace(/<cDV>\d<\/cDV>/, `<cDV>${accessKey[43]}</cDV>`);
  }
  if (recipient === "anonymous") xml = xml.replace(/<dest>[\s\S]*?<\/dest>/, "");
  if (recipient === "cpf") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<CPF>52998224725</CPF>");
  if (recipient === "alphanumeric") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<CNPJ>12ABC34501DE35</CNPJ>");
  if (recipient === "foreign") xml = xml.replace("<CNPJ>11222333000181</CNPJ>", "<idEstrangeiro>TESTE-EXTERIOR</idEstrangeiro>");
  return { xml: signNfeXml(change(xml), key), accessKey };
}
