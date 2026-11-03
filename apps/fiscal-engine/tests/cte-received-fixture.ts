import { SignedXml } from "xml-crypto";
import { accessKeyDigit } from "@/lib/fiscal/nfe";
import type { SigningKey } from "@/lib/fiscal/sign";

const NS = "http://www.portalfiscal.inf.br/cte";
export const CTE_COMPANY = "04252011000110";
export const CTE_CARRIER = "11222333000181";
export const CTE_NFE = "35261012345678000195550010000001231482917364";
const address = "<xLgr>Rua de Teste</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF>";
const party = (tag: string, cnpj: string, addressTag: string) => `<${tag}><CNPJ>${cnpj}</CNPJ><xNome>PARTICIPANTE FICTICIO</xNome><${addressTag}>${address}</${addressTag}></${tag}>`;

/** Test-only CT-e, not an issuance builder. Self-signed certificate/protocol are fictitious. */
export function receivedCteFixture(key: SigningKey, {
  toma = "0", companyRole = "rem", environment = "2", amount = "150.01", documentType = "0", number = "123", change = (xml: string) => xml,
}: { toma?: string; companyRole?: "emit" | "rem" | "exped" | "receb" | "dest" | "toma4" | "autXML" | "none"; environment?: string; amount?: string; documentType?: string; number?: string; change?: (xml: string) => string } = {}) {
  const carrier = companyRole === "emit" ? CTE_COMPANY : CTE_CARRIER;
  const partial = `352610${carrier}57001${number.padStart(9, "0")}148291736`;
  const accessKey = partial + accessKeyDigit(partial);
  const id = `CTe${accessKey}`;
  const taker = toma === "4" ? `<toma4><toma>4</toma><CNPJ>${companyRole === "toma4" ? CTE_COMPANY : "48240052000161"}</CNPJ><xNome>TOMADOR FICTICIO</xNome><enderToma>${address}</enderToma></toma4>` : `<toma3><toma>${toma}</toma></toma3>`;
  const information = `<infCte versao="4.00" Id="${id}"><ide><cUF>35</cUF><cCT>48291736</cCT><CFOP>5353</CFOP><natOp>PRESTACAO FICTICIA</natOp><mod>57</mod><serie>1</serie><nCT>123</nCT><dhEmi>2026-10-02T23:30:00-03:00</dhEmi><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${accessKey[43]}</cDV><tpAmb>${environment}</tpAmb><tpCTe>0</tpCTe><procEmi>0</procEmi><verProc>TESTE</verProc><cMunEnv>3550308</cMunEnv><xMunEnv>SAO PAULO</xMunEnv><UFEnv>SP</UFEnv><modal>01</modal><tpServ>0</tpServ><cMunIni>3550308</cMunIni><xMunIni>SAO PAULO</xMunIni><UFIni>SP</UFIni><cMunFim>3550308</cMunFim><xMunFim>SAO PAULO</xMunFim><UFFim>SP</UFFim><retira>1</retira><indIEToma>9</indIEToma>${taker}</ide>` +
    `<emit><CNPJ>${carrier}</CNPJ><IE>110042490114</IE><xNome>TRANSPORTADORA FICTICIA</xNome><enderEmit>${address}</enderEmit><CRT>1</CRT></emit>` +
    ([['rem','enderReme'],['exped','enderExped'],['receb','enderReceb'],['dest','enderDest']] as const).map(([role, tag]) => party(role, companyRole === role ? CTE_COMPANY : "48240052000161", tag)).join("") +
    `<vPrest><vTPrest>${amount}</vTPrest><vRec>${amount}</vRec></vPrest><imp><ICMS><ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN></ICMS></imp><infCTeNorm><infCarga><vCarga>100.00</vCarga><proPred>CARGA FICTICIA</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1.0000</qCarga></infQ></infCarga><infDoc><infNFe><chave>${CTE_NFE}</chave></infNFe></infDoc><infModal versaoModal="4.00"><rodo><RNTRC>12345678</RNTRC></rodo></infModal></infCTeNorm>` +
    (companyRole === "autXML" ? `<autXML><CNPJ>${CTE_COMPANY}</CNPJ></autXML>` : "") + "</infCte>";
  let typed = information.replace("<nCT>123</nCT>", `<nCT>${number}</nCT>`).replace("<tpCTe>0</tpCTe>", `<tpCTe>${documentType}</tpCTe>`);
  if (documentType === "1") typed = typed.replace(/<infCTeNorm>[\s\S]*?<\/infCTeNorm>/, "<infCteComp><chCTe>35261011222333000181570010000001231482917360</chCTe></infCteComp>");
  const unsigned = `<CTe xmlns="${NS}">${change(typed)}</CTe>`;
  const signer = new SignedXml({ privateKey: key.privateKeyPem, publicCert: `-----BEGIN CERTIFICATE-----\n${key.certificateBase64}\n-----END CERTIFICATE-----`, signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315" });
  signer.addReference({ xpath: "//*[local-name()='infCte']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"], digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1" });
  signer.computeSignature(unsigned);
  const cte = signer.getSignedXml(), digest = /<DigestValue>([^<]+)<\/DigestValue>/.exec(cte)![1];
  return { accessKey, xml: `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="${NS}" versao="4.00">${cte}<protCTe versao="4.00"><infProt><tpAmb>${environment}</tpAmb><verAplic>TESTE</verAplic><chCTe>${accessKey}</chCTe><dhRecbto>2026-10-03T00:00:00-03:00</dhRecbto><nProt>135260000000123</nProt><digVal>${digest}</digVal><cStat>100</cStat><xMotivo>Autorizado o uso do CT-e</xMotivo></infProt></protCTe></cteProc>` };
}
