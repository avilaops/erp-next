import { readCertificate } from "./certificate.ts";
import { sendToSefaz } from "./channel.ts";
import type { Send } from "./channel.ts";
import { buildCteDistributionRequest, CteDistributionError, cteDistributionResponseXml, parseCteDistributionResponse } from "./cte-distribution.ts";
import type { CteDistributionRequest, CteDistributionResult } from "./cte-distribution.ts";
import { assertCteDistributionXml } from "./cte-distribution-layout.ts";

const WSDL = "http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe";
const HOMOLOGATION_URL = "https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx";
type CertificateMaterial = { pfx: Buffer; passphrase: string };
type QueryResult = CteDistributionResult & { rawXml: string; minimumWaitSeconds: number };

/** Internal transport only. Tenant authorization, leases and cooldown persistence belong to Rust. */
export async function queryCteDistribution(input: CteDistributionRequest, certificate: CertificateMaterial, send: Send = sendToSefaz): Promise<QueryResult> {
  if (input.environment !== "homologation") throw new CteDistributionError("Transporte CT-e habilitado exclusivamente em homologação.");
  const requestXml = buildCteDistributionRequest(input);
  const info = readCertificate(certificate.pfx, certificate.passphrase);
  // The official service accepts a common CNPJ base. The ERP deliberately
  // requires the exact company here, matching its existing tenant/A1 policy.
  if (info.holderCnpj !== input.companyTaxId || info.validFrom.valueOf() > Date.now() || info.validUntil.valueOf() <= Date.now()) throw new CteDistributionError("Certificado CT-e vencido ou incompatível com o CNPJ da empresa.");
  await assertCteDistributionXml(requestXml, "request");
  const data = requestXml.replace(/^<\?xml[^?]*\?>/, "");
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDistDFeInteresse xmlns="${WSDL}"><cteDadosMsg>${data}</cteDadosMsg></cteDistDFeInteresse></soap12:Body></soap12:Envelope>`;
  const rawXml = await send(HOMOLOGATION_URL, `${WSDL}/cteDistDFeInteresse`, envelope, certificate);
  const responseXml = cteDistributionResponseXml(rawXml);
  await assertCteDistributionXml(responseXml, "response");
  const result = parseCteDistributionResponse(responseXml, input);
  // A complete feed or cStat 137 requires one hour (NT 2015.002 §2.5).
  // For 656, one hour is a local minimum; it is not a claim of automatic release.
  const minimumWaitSeconds = result.code === "137" || result.code === "656" || (result.nextNsu !== null && result.lastNsu === result.maxNsu) ? 3600 : result.nextNsu === null ? 60 : 0;
  return { ...result, rawXml, minimumWaitSeconds };
}
