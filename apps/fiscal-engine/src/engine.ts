import { buildNfeXml, accessKeyDigit, nfeTotals, UF_CODES, IPI_TAXED_CSTS, IPI_UNTAXED_CSTS } from "./lib/fiscal/nfe.ts";
import type { NfeInput } from "./lib/fiscal/nfe.ts";
import { readCertificate } from "./lib/fiscal/certificate.ts";
import { signNfeXml, signEventXml, signVoidXml, signingKeyOf } from "./lib/fiscal/sign.ts";
import { assertFiscalXml } from "./lib/fiscal/local-layout.ts";
import { sendToSefaz } from "./lib/fiscal/channel.ts";
import type { Send } from "./lib/fiscal/channel.ts";
import { AUTHORIZATION_ACTION, CONSULT_ACTION, VOID_ACTION, authorizationEnvelope, authorizationUrl, consultEnvelope, consultUrl, consultEvents, nfeProcXml, parseAuthorization, parseConsult, parseVoid, voidEnvelope, voidUrl, voidXml } from "./lib/fiscal/sefaz.ts";
import { EVENT_ACTION, eventEnvelope, eventUrl, eventXml, parseEvent, processedEventXml } from "./lib/fiscal/events.ts";
import { DISTRIBUTION_ACTION, distributionEnvelope, distributionUrl, parseDistributionResponse } from "./lib/fiscal/distribution.ts";
import { recipientManifestXml } from "./lib/fiscal/recipient-manifest.ts";
import type { RecipientManifestKind } from "./lib/fiscal/recipient-manifest.ts";
import municipalities from "./lib/fiscal/municipios.json" with { type: "json" };
import { roundCents } from "./lib/pricing/money.ts";
import { SignedXml } from "xml-crypto";

type ObjectValue = Record<string, unknown>;
export class EngineInputError extends Error {
  code: string;
  constructor(message: string, code = "invalid_fiscal_input") { super(message); this.code = code; }
}
const refuse = (message: string, code?: string): never => { throw new EngineInputError(message, code); };
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("Objeto fiscal inválido");
  return value as ObjectValue;
}
function text(value: unknown, label = "Campo", max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) return refuse(`${label} inválido`);
  return value;
}
function whole(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) return refuse("Número fiscal inválido");
  return value;
}
function decimal(value: unknown, scale: number): number {
  const s = text(value, "Decimal");
  if (!new RegExp(`^(0|[1-9][0-9]{0,10})\\.[0-9]{${scale}}$`).test(s)) return refuse("Decimal fora do recorte do motor fiscal");
  const n = Number(s);
  if (!Number.isFinite(n) || n.toFixed(scale) !== s) return refuse("Decimal excede a precisão do motor fiscal");
  return n;
}
function date(value: unknown): string {
  const raw = text(value, "Data", 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return refuse("Data fiscal inválida");
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.valueOf())) return refuse("Data fiscal inválida");
  return `${new Date(parsed.valueOf() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
}
function city(state: string, code: unknown): string {
  const rows = (municipalities as Record<string, string[][]>)[state];
  const found = rows?.find(([, candidate]) => candidate === code);
  if (!found) return refuse("Código do município não localizado na tabela IBGE da UF", "municipality_unresolved");
  return found[0];
}
function homologation(input: ObjectValue): void {
  if (input.environment !== "homologation") refuse("Motor habilitado exclusivamente em homologação");
}
export const recipientEventUrl = (environment: "homologacao" | "producao") => environment === "homologacao"
  ? "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"
  : "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
function validKey(value: unknown): string {
  const key = text(value, "Chave de acesso", 44);
  if (!/^\d{44}$/.test(key) || key[43] !== accessKeyDigit(key.slice(0, 43)) || key.slice(20, 22) !== "55") return refuse("Chave NF-e inválida");
  return key;
}

function declaredBoolean(input: ObjectValue, key: string): boolean {
  if (typeof input[key] !== "boolean") return refuse(`Declare ${key} conforme a instrução fiscal`);
  return input[key];
}
function declaredObject(value: unknown, fields: string[]): ObjectValue {
  const input = object(value);
  if (Object.keys(input).some((key) => !fields.includes(key))) refuse("Campo desconhecido na declaração tributária");
  return input;
}
function rate(value: unknown, required: boolean): number {
  if (value == null && !required) return 0;
  if (value == null) return refuse("Declare a alíquota exigida pelo CST, inclusive zero, em percentual com quatro casas decimais");
  const percent = decimal(value, 4);
  if (percent >= 100 || (!required && percent !== 0)) return refuse("Alíquota fora do recorte: percentual de 0 a menos de 100, zero para CST sem tributação");
  const fraction = percent / 100;
  if ((fraction * 100).toFixed(4) !== value) refuse("Alíquota excede a precisão do motor fiscal");
  return fraction;
}
const centsOf = (value: number) => BigInt(value.toFixed(2).replace(".", ""));
const formatCents = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
const taxCents = (base: bigint, fraction: number) => (base * BigInt((fraction * 100).toFixed(4).replace(".", "")) + 500_000n) / 1_000_000n;

/** Compare every item and total with integer arithmetic before the legacy
 * floating-point XML builder runs. Values it cannot preserve are refused. */
function assertExactTaxes(mapped: NfeInput, declaredProducts: bigint): void {
  const keys = ["products", "ipi", "icmsBase", "icms", "pis", "cofins", "invoice", "reformBase", "ibsState", "ibsCity", "cbs"] as const;
  const totals = Object.fromEntries(keys.map((key) => [key, 0n])) as Record<typeof keys[number], bigint>;
  for (const item of mapped.items) {
    const product = centsOf(roundCents(item.quantity * item.unitPrice));
    const ipi = taxCents(product, item.ipiRate);
    const icmsBase = mapped.issuer.taxRegime === 3 && mapped.rules.icmsCode === "00" ? product + (mapped.rules.finalConsumer && mapped.rules.ipiInIcmsBase ? ipi : 0n) : 0n;
    const icms = taxCents(icmsBase, mapped.icmsRate);
    const contributionBase = product - (mapped.rules.icmsOutOfContributions ? icms : 0n);
    const pis = taxCents(contributionBase, mapped.rules.pisRate), cofins = taxCents(contributionBase, mapped.rules.cofinsRate);
    const reformBase = mapped.rules.ibsCbs ? product - icms - pis - cofins : 0n;
    if (contributionBase < 0n || reformBase < 0n) refuse("Base tributária negativa fora do recorte");
    const expected = { products: product, ipi, icmsBase, icms, pis, cofins, invoice: product + ipi, reformBase, ibsState: taxCents(reformBase, mapped.rules.ibsCbs?.ibsStateRate ?? 0), ibsCity: taxCents(reformBase, mapped.rules.ibsCbs?.ibsCityRate ?? 0), cbs: taxCents(reformBase, mapped.rules.ibsCbs?.cbsRate ?? 0) };
    const actual = nfeTotals({ ...mapped, items: [item] });
    if (roundCents(actual.ibsState + actual.ibsCity).toFixed(2) !== formatCents(expected.ibsState + expected.ibsCity)) refuse("IBS do item excede a precisão do motor fiscal");
    for (const key of keys) {
      if (actual[key].toFixed(2) !== formatCents(expected[key])) refuse("Tributos do item excedem a precisão do motor fiscal");
      totals[key] += expected[key];
    }
  }
  const actual = nfeTotals(mapped);
  for (const key of keys) if (totals[key] > 999_999_999_999_999n || actual[key].toFixed(2) !== formatCents(totals[key])) refuse("Totais tributários excedem a precisão do motor fiscal");
  if (totals.ibsState + totals.ibsCity > 999_999_999_999_999n || roundCents(actual.ibsState + actual.ibsCity).toFixed(2) !== formatCents(totals.ibsState + totals.ibsCity)) refuse("Total do IBS excede a precisão do motor fiscal");
  if (totals.products !== declaredProducts) refuse("Total de produtos diverge do motor fiscal");
}

/** Only explicit, uniform tax classifications are mapped. No NCM, recipient
 * or rate is used to infer the choices of the responsible fiscal operator. */
export function mapDraft(value: unknown): NfeInput {
  const input = object(value); homologation(input);
  const issuer = object(input.issuer), company = object(issuer.company), profile = object(issuer.profile), draft = object(input.draft);
  if (profile.crt !== 1 && profile.crt !== 3 || profile.state !== "SP" || draft.environment !== "homologation" || draft.model !== 55) refuse("Emissão fora do recorte: NF-e 55, SP, CRT 1 ou 3 em homologação", "tax_rule_scope");
  const recipient = object(draft.recipient), state = text(recipient.state, "UF", 2);
  const rawItems = draft.items;
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 990) refuse("Itens fiscais inválidos");
  const first = object(rawItems[0]);
  const normal = profile.crt === 3;
  text(draft.taxRuleReference, "Referência da instrução fiscal", 200);
  const contributionCodes = normal ? ["01", "02", "04", "05", "06", "07", "08", "09"] : ["04", "05", "06", "07", "08", "09"];
  if ((normal ? !["00", "40", "41", "50"].includes(String(first.icmsCst)) || first.csosn != null : !["102", "103", "300", "400"].includes(String(first.csosn)) || first.icmsCst != null) || !contributionCodes.includes(String(first.pisCst)) || !contributionCodes.includes(String(first.cofinsCst))) refuse("Classificação fora do recorte: exige regras ou alíquotas ainda não informadas no rascunho", "tax_rule_scope");
  if (normal && state !== "SP" || !normal && draft.taxDeclaration != null) refuse("Declaração tributária disponível para CRT 3 em operação interna SP", "tax_rule_scope");
  if (normal && draft.taxDeclaration == null) refuse("CRT 3 exige declaração tributária explícita conforme a instrução do responsável fiscal", "tax_rule_scope");
  const declaration = normal ? declaredObject(draft.taxDeclaration, ["recipientTaxpayer", "recipientStateRegistration", "finalConsumer", "icmsRate", "pisRate", "cofinsRate", "ipiCst", "ipiFrameCode", "ipiRate", "ipiInIcmsBase", "icmsOutOfContributions", "ibsCbs"]) : null;
  const taxpayer = declaration ? declaredBoolean(declaration, "recipientTaxpayer") : false;
  const finalConsumer = declaration ? declaredBoolean(declaration, "finalConsumer") : true;
  const stateRegistration = declaration?.recipientStateRegistration == null ? null : text(declaration.recipientStateRegistration, "IE do destinatário", 14);
  if (taxpayer ? !stateRegistration || !/^\d{2,14}$/.test(stateRegistration) : stateRegistration !== null || !finalConsumer || first.icmsCst === "50") refuse("Declaração de contribuinte, inscrição estadual ou consumidor final incompatível");
  const icmsRate = declaration ? rate(declaration.icmsRate, first.icmsCst === "00") : 0;
  const pisRate = declaration ? rate(declaration.pisRate, ["01", "02"].includes(String(first.pisCst))) : 0;
  const cofinsRate = declaration ? rate(declaration.cofinsRate, ["01", "02"].includes(String(first.cofinsCst))) : 0;
  const ipiCst = declaration?.ipiCst == null ? null : text(declaration.ipiCst, "CST do IPI", 2);
  if (ipiCst !== null && ![...IPI_TAXED_CSTS, ...IPI_UNTAXED_CSTS].includes(ipiCst)) refuse("CST do IPI fora do recorte");
  const ipiRate = declaration ? rate(declaration.ipiRate, ipiCst !== null && IPI_TAXED_CSTS.includes(ipiCst)) : 0;
  const ipiFrameCode = ipiCst === null ? "999" : text(declaration?.ipiFrameCode, "Enquadramento do IPI", 3);
  if (!/^\d{3}$/.test(ipiFrameCode) || ipiCst === null && declaration?.ipiFrameCode != null) refuse("Enquadramento do IPI incompatível com o CST declarado");
  const ibs = declaration ? declaredObject(declaration.ibsCbs, ["cst", "classCode", "ibsStateRate", "ibsCityRate", "cbsRate"]) : null;
  if (ibs && (ibs.cst !== "000" || ibs.classCode !== "000001")) refuse("IBS/CBS fora do recorte tributado integral 000/000001", "tax_rule_scope");
  const ibsCbs = ibs ? { cst: "000", classCode: "000001", ibsStateRate: rate(ibs.ibsStateRate, true), ibsCityRate: rate(ibs.ibsCityRate, true), cbsRate: rate(ibs.cbsRate, true) } : null;
  const cfop = text(first.cfop, "CFOP", 4);
  if (!new RegExp(`^${state === "SP" ? "5" : "6"}[0-9]{3}$`).test(cfop)) refuse("CFOP incompatível com destino");
  let cents = 0n;
  const items = rawItems.map((raw) => {
    const item = object(raw);
    for (const field of ["csosn", "icmsCst", "pisCst", "cofinsCst", "cfop"]) if (item[field] !== first[field]) refuse("O recorte exige a mesma classificação fiscal por item; separe as operações");
    const quantity = decimal(item.quantity, 4), unitPrice = decimal(item.unitPrice, 10);
    const gross = text(item.grossTotal, "Total", 17);
    if (!/^(0|[1-9][0-9]{0,12})\.\d{2}$/.test(gross) || quantity <= 0 || unitPrice <= 0 || BigInt(gross.replace(".", "")) <= 0n || roundCents(quantity * unitPrice).toFixed(2) !== gross) refuse("Total do item diverge do cálculo exato do rascunho");
    const exactGross = (BigInt(String(item.quantity).replace(".", "")) * BigInt(String(item.unitPrice).replace(".", "")) + 500_000_000_000n) / 1_000_000_000_000n;
    if (formatCents(exactGross) !== gross) refuse("Total do item diverge do cálculo inteiro do rascunho");
    cents += BigInt(gross.replace(".", ""));
    if (!Number.isInteger(item.origin) || Number(item.origin) < 0 || Number(item.origin) > 8) refuse("Origem inválida");
    return { code: text(item.code, "Código", 60), name: text(item.description, "Descrição", 120), ncm: text(item.ncm, "NCM", 8), cest: null, origin: Number(item.origin), unit: text(item.unit, "Unidade", 6), quantity, unitPrice, ipiRate };
  });
  const productsTotal = text(draft.productsTotal, "Total de produtos", 17);
  if (!/^(0|[1-9][0-9]{0,12})\.\d{2}$/.test(productsTotal) || cents !== BigInt(productsTotal.replace(".", "")) || cents > BigInt(Number.MAX_SAFE_INTEGER)) refuse("Total de produtos diverge da soma dos itens");
  const taxId = text(issuer.taxId, "CNPJ", 14);
  if (company.taxId !== taxId || !/^\d{14}$/.test(taxId)) refuse("CNPJ do emitente diverge do cadastro");
  const recipientTaxId = text(recipient.taxId, "Documento", 14);
  if (!Array.isArray(draft.payments) || !draft.payments.length || draft.payments.length > 100) refuse("Informe as formas de pagamento declaradas na nota; não são inferidas dos recebimentos", "payments_required");
  const payments = draft.payments.map((raw) => {
    const payment = object(raw), code = text(payment.code, "Forma de pagamento", 2);
    if (!["01", "03", "04", "15", "16", "17", "18", "90", "99"].includes(code)) refuse("Forma de pagamento fora do recorte fiscal");
    const amount = decimal(payment.amount, 2);
    return { code, description: payment.description == null ? null : text(payment.description, "Descrição do pagamento", 60), amount };
  });
  const noPayment = payments.some((payment) => payment.code === "90");
  const mapped: NfeInput = {
    environment: "homologacao", freightMode: "9", transport: { carrier: null, volumes: null, volumeKind: null, netWeight: null, grossWeight: null }, delivery: null,
    series: whole(profile.series, 999), number: whole(input.number, 999_999_999), randomCode: text(input.randomCode, "Código aleatório", 8), issuedAt: date(input.issuedAt),
    issuer: { cnpj: taxId, legalName: text(company.legalName, "Razão social", 60), stateRegistration: text(profile.stateRegistration, "IE", 14), taxRegime: normal ? 3 : 1, street: text(company.street), number: text(company.number), district: text(company.district), cityCode: text(profile.municipalityCode), city: city("SP", profile.municipalityCode), uf: "SP", cep: text(company.postalCode, "CEP", 8) },
    recipient: { kind: recipientTaxId.length === 11 ? "PF" : "PJ", document: recipientTaxId, name: text(recipient.legalName, "Destinatário", 60), stateRegistration, taxpayer, street: text(recipient.street), number: text(recipient.number), district: text(recipient.district), cityCode: text(recipient.municipalityCode), city: city(state, recipient.municipalityCode), uf: state, cep: text(recipient.postalCode, "CEP", 8) },
    rules: { operationNature: text(draft.operationNature, "Natureza", 60), cfopInternal: `5${cfop.slice(1)}`, cfopInterstate: `6${cfop.slice(1)}`, cfopInterstateNonTaxpayer: `6${cfop.slice(1)}`, icmsCode: String(normal ? first.icmsCst : first.csosn), ipiCst, ipiFrameCode, pisCst: String(first.pisCst), pisRate, cofinsCst: String(first.cofinsCst), cofinsRate, finalConsumer, ipiInIcmsBase: declaration ? declaredBoolean(declaration, "ipiInIcmsBase") : false, icmsOutOfContributions: declaration ? declaredBoolean(declaration, "icmsOutOfContributions") : false, additionalInfo: null, ibsCbs },
    items, icmsRate, destination: { internalIcms: 0, fcp: 0 },
    payments, software: "ERP Next 0.1",
  };
  assertExactTaxes(mapped, cents);
  const invoice = nfeTotals(mapped).invoice.toFixed(2);
  const paymentCents = payments.reduce((sum, payment) => sum + centsOf(payment.amount), 0n);
  if (noPayment ? payments.length !== 1 || payments[0].amount !== 0 : formatCents(paymentCents) !== invoice || roundCents(payments.reduce((sum, payment) => sum + payment.amount, 0)).toFixed(2) !== invoice) refuse("Valores das formas de pagamento divergem do total da nota, incluindo IPI");
  return mapped;
}

function material(input: ObjectValue, expected: string) {
  const certificate = object(input.certificate);
  const encoded = text(certificate.pkcs12Base64, "Certificado", 90_000);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || typeof certificate.password !== "string" || certificate.password.length > 1024) refuse("Certificado inválido");
  const pfx = Buffer.from(encoded, "base64"), info = readCertificate(pfx, certificate.password);
  if (info.holderCnpj !== expected || info.validFrom.valueOf() > Date.now() || info.validUntil.valueOf() <= Date.now()) refuse("Certificado vencido ou incompatível com o CNPJ", "certificate_invalid");
  return { pfx, passphrase: certificate.password };
}

/** Only fixed authority endpoints exist here. No URL from a request is used. */
export async function dispatch(operation: string, value: unknown, send: Send = sendToSefaz): Promise<ObjectValue> {
  const input = object(value); homologation(input);
  if (operation === "prepare") {
    const mapped = mapDraft(input), credentials = material(input, mapped.issuer.cnpj);
    const generated = buildNfeXml(mapped), signedXml = signNfeXml(generated.xml, signingKeyOf(credentials.pfx, credentials.passphrase));
    await assertFiscalXml(signedXml, "nfe");
    return { accessKey: generated.key, signedXml };
  }
  if (operation === "authorize" || operation === "consult") {
    const key = validKey(input.accessKey), credentials = material(input, key.slice(6, 20));
    if (key.slice(0, 2) !== "35") refuse("Autorizador ainda restrito a São Paulo");
    let signed: string | undefined;
    if (operation === "authorize" || input.signedXml != null) {
      signed = text(input.signedXml, "XML assinado", 1_048_576);
      if (!signed.includes(`Id="NFe${key}"`) || !signed.includes("<tpAmb>2</tpAmb>")) refuse("XML diverge da chave ou do ambiente");
      await assertFiscalXml(signed, "nfe");
      // A consultation authenticates using the current A1. The historical XML
      // may have been signed with an older certificate and is never retransmitted.
      if (operation === "authorize") {
        const signature = /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature>/.exec(signed)?.[0];
        const ownKey = signingKeyOf(credentials.pfx, credentials.passphrase);
        const checker = new SignedXml({ publicCert: `-----BEGIN CERTIFICATE-----\n${ownKey.certificateBase64}\n-----END CERTIFICATE-----`, getCertFromKeyInfo: () => null });
        if (!signature) refuse("XML sem assinatura verificável");
        checker.loadSignature(signature);
        if (!checker.checkSignature(signed) || checker.getReferences().length !== 1 || checker.getReferences()[0].uri !== `#NFe${key}`) refuse("Assinatura do XML diverge do certificado ou da chave");
      }
    }
    const rawXml = operation === "authorize"
      ? await send(authorizationUrl("SP", "homologacao"), AUTHORIZATION_ACTION, authorizationEnvelope(signed!, String(input.batch ?? "1")), credentials)
      : await send(consultUrl("SP", "homologacao"), CONSULT_ACTION, consultEnvelope(key, "homologacao"), credentials);
    const parsed = operation === "authorize" ? parseAuthorization(rawXml, key) : parseConsult(rawXml, key);
    const duplicates = ["204", "205", "206", "218", "539"];
    const status = duplicates.includes(parsed.code) ? "unknown" : ({ autorizada: "authorized", rejeitada: "rejected", cancelada: "cancelled", "nao-consta": "not_found", denegada: "denied" } as Record<string, string>)[parsed.status] ?? "unknown";
    const originalProtocol = status === "cancelled" ? /<protNFe\b[\s\S]*?<\/protNFe>/.exec(rawXml)?.[0] : undefined;
    const protocolXml = "protocolXml" in parsed ? parsed.protocolXml : originalProtocol;
    const protocol = "protocol" in parsed ? parsed.protocol : originalProtocol ? /<nProt>(\d+)<\/nProt>/.exec(originalProtocol)?.[1] : null;
    return { status, code: parsed.code, reason: parsed.reason, protocol, xml: protocolXml && signed ? nfeProcXml(signed, protocolXml) : null, rawXml, ...(operation === "consult" ? { events: consultEvents(rawXml, key) } : {}) };
  }
  if (operation === "distribute") {
    const cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    const rawXml = await send(distributionUrl("homologacao"), DISTRIBUTION_ACTION, distributionEnvelope(cnpj, text(input.lastNsu, "NSU", 15), "homologacao"), credentials);
    return { ...parseDistributionResponse(rawXml), rawXml };
  }
  if (operation === "event" || operation === "manifest") {
    const key = validKey(input.accessKey), cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    const signingKey = signingKeyOf(credentials.pfx, credentials.passphrase);
    let xml: string, endpoint: string;
    if (operation === "event") {
      if (key.slice(6, 20) !== cnpj || key.slice(0, 2) !== "35") refuse("Evento não pertence ao emitente SP");
      if (input.kind !== "cancelamento" && input.kind !== "correcao") refuse("Tipo de evento inválido");
      xml = eventXml({ kind: input.kind, environment: "homologacao", accessKey: key, cnpj, at: date(input.issuedAt), sequence: whole(input.sequence, 20), protocol: typeof input.protocol === "string" ? input.protocol : undefined, text: text(input.text, "Texto do evento", 1000) }).xml;
      endpoint = eventUrl("SP", "homologacao");
    } else {
      if (!["ciencia", "confirmacao", "desconhecimento", "nao_realizada"].includes(String(input.kind))) refuse("Tipo de manifestação inválido");
      xml = recipientManifestXml({ accessKey: key, cnpj, environment: "homologacao", at: date(input.issuedAt), kind: input.kind as RecipientManifestKind, reason: typeof input.justification === "string" ? input.justification : undefined }).xml;
      endpoint = recipientEventUrl("homologacao");
    }
    const signed = signEventXml(xml, signingKey);
    await assertFiscalXml(signed, "evento");
    const rawXml = await send(endpoint, EVENT_ACTION, eventEnvelope(signed, "1"), credentials), parsed = parseEvent(rawXml, key);
    return { ...parsed, xml: parsed.registered ? processedEventXml(signed, rawXml) : signed, rawXml };
  }
  if (operation === "void") {
    if (input.state !== "SP") refuse("Inutilização ainda restrita a São Paulo");
    const cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    const year = String(input.year);
    if (!/^\d{2}$/.test(year) && !/^20\d{2}$/.test(year)) refuse("Ano de inutilização inválido");
    const generated = voidXml({ environment: "homologacao", stateCode: UF_CODES.SP, year: year.slice(-2), cnpj, series: whole(input.series, 999), first: whole(input.first, 999_999_999), last: whole(input.last, 999_999_999), reason: text(input.text, "Justificativa", 255) });
    const signed = signVoidXml(generated.xml, signingKeyOf(credentials.pfx, credentials.passphrase));
    await assertFiscalXml(signed, "inutilizacao");
    const rawXml = await send(voidUrl("SP", "homologacao"), VOID_ACTION, voidEnvelope(signed), credentials);
    const receipt = /<retInutNFe\b[\s\S]*?<\/retInutNFe>/.exec(rawXml)?.[0];
    const xml = receipt ? `<procInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${signed}${receipt}</procInutNFe>` : signed;
    return { ...parseVoid(rawXml), xml, rawXml };
  }
  return refuse("Operação fiscal desconhecida");
}
