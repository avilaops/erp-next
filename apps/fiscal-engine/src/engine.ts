import { financialLegacyMode, financialNoteProblems } from "./lib/fiscal/financial-note.ts";
import { buildNfeXml, accessKeyDigit, nfeTotals, nfeProblems, UF_CODES, IPI_TAXED_CSTS, IPI_UNTAXED_CSTS, exactFiscalCents, INVALID_FISCAL_TEXT, NFE_MAX_CENTS } from "./lib/fiscal/nfe.ts";
import type { NfeInput, NfeItem } from "./lib/fiscal/nfe.ts";
import { readCertificate } from "./lib/fiscal/certificate.ts";
import { signNfeXml, signEventXml, signVoidXml, signingKeyOf } from "./lib/fiscal/sign.ts";
import { assertFiscalXml } from "./lib/fiscal/local-layout.ts";
import { sendToSefaz } from "./lib/fiscal/channel.ts";
import type { Send } from "./lib/fiscal/channel.ts";
import { AUTHORIZATION_ACTION, CONSULT_ACTION, VOID_ACTION, authorizationEnvelope, authorizationUrl, consultEnvelope, consultUrl, consultEvents, nfeProcXml, parseAuthorization, parseConsult, parseVoid, voidEnvelope, voidUrl, voidXml } from "./lib/fiscal/sefaz.ts";
import { EVENT_ACTION, eventEnvelope, eventUrl, eventXml, parseEvent, processedEventXml } from "./lib/fiscal/events.ts";
import { DISTRIBUTION_ACTION, distributionEnvelope, distributionUrl, parseDistributionResponse } from "./lib/fiscal/distribution.ts";
import { recipientManifestXml } from "./lib/fiscal/recipient-manifest.ts";
import { supplementSimplifiedNfe } from "./lib/fiscal/simplified-nfe.ts";
import { createNfceQrPayload } from "./lib/fiscal/nfce-qr.ts";
import { queryCteDistribution } from "./lib/fiscal/cte-distribution-client.ts";
import { inspectReceivedNationalNfse } from "./lib/fiscal/nfse-received.ts";
import { NationalNfseXmlError } from "./lib/fiscal/nfse-layout.ts";
import { inspectReceivedCte, CteInspectionError } from "./lib/fiscal/cte-received.ts";
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
function fiscalEnvironment(input: ObjectValue): "homologacao" | "producao" {
  if (input.environment === "homologation") return "homologacao";
  if (input.environment === "production") return "producao";
  return refuse("Informe homologação ou produção para a operação fiscal");
}
export const recipientEventUrl = (environment: "homologacao" | "producao") => environment === "homologacao"
  ? "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx"
  : "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
function validKey(value: unknown): string {
  const key = text(value, "Chave de acesso", 44);
  if (!/^\d{44}$/.test(key) || key[43] !== accessKeyDigit(key.slice(0, 43)) || !["55", "65"].includes(key.slice(20, 22))) return refuse("Chave NF-e/NFC-e inválida");
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

function optionalMoney(value: unknown): number {
  if (value == null) return 0;
  const cents = exactFiscalCents(value);
  if (cents === null) return refuse("Frete ou desconto exige valor não negativo com duas casas decimais");
  const amount = Number(cents) / 100;
  if (amount.toFixed(2) !== value) return refuse("Frete ou desconto excede a precisão do motor fiscal");
  return amount;
}

const commercialCents = (item: NfeItem) => centsOf(roundCents(item.quantity * item.unitPrice)) + centsOf(item.freightAmount ?? 0) + centsOf(item.insuranceAmount ?? 0) + centsOf(item.otherAmount ?? 0) - centsOf(item.discountAmount ?? 0);

function ibptText(value: unknown, label: string, max = 200): string {
  const result = text(value, label, max);
  if (INVALID_FISCAL_TEXT.test(result)) refuse(`${label} contém controles inválidos`);
  return result;
}

function ibptDate(value: unknown): string {
  const result = ibptText(value, "Data IBPT", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return refuse("Data IBPT inválida");
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) refuse("Data IBPT inválida");
  return result;
}

function ibptMoney(value: unknown): bigint {
  const cents = exactFiscalCents(value);
  if (cents === null) return refuse("Valor IBPT fora do limite da NF-e ou sem duas casas decimais");
  return cents;
}

const IBPT_COMPONENTS = ["federal", "state", "municipal", "total"] as const;
type IbptAmounts = Record<typeof IBPT_COMPONENTS[number], bigint>;
function ibptAmounts(value: unknown): IbptAmounts {
  const source = declaredObject(value, [...IBPT_COMPONENTS]);
  const result = Object.fromEntries(IBPT_COMPONENTS.map(key => [key, ibptMoney(source[key])])) as IbptAmounts;
  if (result.federal + result.state + result.municipal !== result.total) refuse("Soma dos tributos aproximados IBPT divergente");
  return result;
}

/** The API resolves percentages and persists provenance. The engine verifies
 * that this exact snapshot still belongs to this tenant, draft and issue date. */
function mapIbptSnapshot(input: ObjectValue, draft: ObjectValue, mapped: NfeInput): NfeInput["approximateTaxes"] {
  if (draft.ibpt == null && input.ibptSnapshot == null) return undefined;
  if (draft.ibpt == null || input.ibptSnapshot == null) return refuse("Seleção IBPT e snapshot devem estar presentes em conjunto");
  const selection = declaredObject(draft.ibpt, ["uf", "asOf", "items"]);
  const snapshot = declaredObject(input.ibptSnapshot, ["tenantId", "uf", "asOf", "items", "amounts"]);
  const tenant = ibptText(input.tenantId, "Tenant IBPT", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant) || typeof snapshot.tenantId !== "string" || snapshot.tenantId.toLowerCase() !== tenant.toLowerCase()) refuse("Tenant do snapshot IBPT divergente");
  const uf = ibptText(selection.uf, "UF IBPT", 2), asOf = ibptDate(selection.asOf);
  if (!Object.hasOwn(UF_CODES, uf) || snapshot.uf !== uf || ibptDate(snapshot.asOf) !== asOf || mapped.issuedAt.slice(0, 10) !== asOf) refuse("UF ou data do snapshot IBPT diverge da seleção ou emissão");
  if (!Array.isArray(selection.items) || !Array.isArray(snapshot.items) || selection.items.length !== mapped.items.length || snapshot.items.length !== mapped.items.length) return refuse("Quantidade de itens IBPT divergente");
  const selectedItems = selection.items, snapshotItems = snapshot.items;
  const totals: IbptAmounts = { federal: 0n, state: 0n, municipal: 0n, total: 0n };
  const sources = new Set<string>();
  const items = mapped.items.map((item, index) => {
    const choice = declaredObject(selectedItems[index], ["ex", "origin", "version"]);
    const entry = declaredObject(snapshotItems[index], ["itemCode", "code", "ex", "origin", "amount", "metadata", "amounts"]);
    const metadata = declaredObject(entry.metadata, ["uf", "classification", "version", "source", "key", "validFrom", "validTo", "sha256"]);
    const ex = ibptText(choice.ex, "EX IBPT", 3), origin = choice.origin;
    const itemCode = ibptText(entry.itemCode, "Código do item IBPT", 60);
    if (!/^\d{1,3}$/.test(ex) || !["national", "imported"].includes(String(origin)) || entry.ex !== ex || entry.origin !== origin || itemCode !== item.code || entry.code !== item.ncm || !/^\d{8}$/.test(item.ncm)) refuse("Vínculo de item, NCM, EX ou origem IBPT divergente");
    const version = ibptText(metadata.version, "Versão IBPT", 6);
    if (!/^\d{2}\.\d\.[A-Z]$/.test(version) || choice.version != null && choice.version !== version) refuse("Versão do snapshot IBPT divergente");
    const validFrom = ibptDate(metadata.validFrom), validTo = ibptDate(metadata.validTo);
    if (metadata.uf !== uf || metadata.classification !== "ncm" || validFrom > asOf || validTo < asOf || typeof metadata.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(metadata.sha256)) refuse("Proveniência ou vigência do snapshot IBPT inválida");
    const source = ibptText(metadata.source, "Fonte IBPT"), key = ibptText(metadata.key, "Chave IBPT");
    // JSON tuple avoids ambiguous deduplication when a source contains separators.
    sources.add(JSON.stringify([source, version, uf, key]));
    const product = commercialCents(item);
    if (ibptMoney(entry.amount) !== product + taxCents(product, item.ipiRate)) refuse("Base do snapshot IBPT diverge do item com frete, desconto e IPI");
    const amounts = ibptAmounts(entry.amounts);
    for (const component of IBPT_COMPONENTS) {
      totals[component] += amounts[component];
      if (totals[component] > NFE_MAX_CENTS) refuse("Total IBPT excede o limite da NF-e");
    }
    return formatCents(amounts.total);
  });
  const declared = ibptAmounts(snapshot.amounts);
  for (const component of IBPT_COMPONENTS) if (totals[component] !== declared[component]) refuse("Total do snapshot IBPT diverge dos itens");
  const provenance = [...sources].map(value => {
    const [source, version, state, key] = JSON.parse(value) as string[];
    return `${source} (versão ${version}, UF ${state}, chave ${key})`;
  }).join("; ");
  const additionalInfo = `Tributos aproximados: federais R$ ${formatCents(totals.federal)}; estaduais R$ ${formatCents(totals.state)}; municipais R$ ${formatCents(totals.municipal)}; total R$ ${formatCents(totals.total)}. Fontes: ${provenance}`;
  if (additionalInfo.length + (mapped.rules.additionalInfo ? mapped.rules.additionalInfo.length + 2 : 0) > 5000) refuse("Proveniência IBPT excede o limite de 5000 caracteres das informações adicionais");
  return { items, total: formatCents(totals.total), additionalInfo };
}

/** Compare every item and total with integer arithmetic before the legacy
 * floating-point XML builder runs. Values it cannot preserve are refused. */
function assertExactTaxes(mapped: NfeInput, declaredProducts: bigint): void {
  const keys = ["products", "freight", "discount", "ipi", "icmsBase", "icms", "pis", "cofins", "difal", "fcp", "invoice", "reformBase", "ibsState", "ibsCity", "cbs"] as const;
  const totals = Object.fromEntries(keys.map((key) => [key, 0n])) as Record<typeof keys[number], bigint>;
  for (const item of mapped.items) {
    const product = centsOf(roundCents(item.quantity * item.unitPrice));
    const freight = centsOf(item.freightAmount ?? 0), discount = centsOf(item.discountAmount ?? 0);
    const commercial = product + freight + centsOf(item.insuranceAmount ?? 0) + centsOf(item.otherAmount ?? 0) - discount;
    const ipi = taxCents(commercial, item.ipiRate);
    const icmsBase = financialLegacyMode(mapped) === "all" && mapped.issuer.taxRegime === 3 && mapped.rules.icmsCode === "00" ? commercial + (mapped.rules.finalConsumer && mapped.rules.ipiInIcmsBase ? ipi : 0n) : 0n;
    const icms = taxCents(icmsBase, mapped.icmsRate);
    const contributionBase = commercial - (mapped.rules.icmsOutOfContributions ? icms : 0n);
    const pis = taxCents(contributionBase, mapped.rules.pisRate), cofins = taxCents(contributionBase, mapped.rules.cofinsRate);
    const owesDifal = mapped.purpose !== 5 && mapped.purpose !== 6 && mapped.issuer.taxRegime === 3 && mapped.rules.icmsCode === "00" && mapped.recipient.uf !== "EX" && mapped.recipient.uf !== mapped.issuer.uf && !mapped.recipient.taxpayer && mapped.rules.finalConsumer;
    const difal = owesDifal ? taxCents(icmsBase, mapped.destination.internalIcms - mapped.icmsRate) : 0n;
    const fcp = owesDifal ? taxCents(icmsBase, mapped.destination.fcp) : 0n;
    const reformBase = mapped.rules.ibsCbs && mapped.rules.ibsCbs.cst !== "410" ? commercial - icms - pis - cofins - difal - fcp : 0n;
    if (contributionBase < 0n || reformBase < 0n) refuse("Base tributária negativa fora do recorte");
    const expected = { products: product, freight, discount, ipi, icmsBase, icms, pis, cofins, difal, fcp, invoice: commercial + ipi, reformBase, ibsState: taxCents(reformBase, mapped.rules.ibsCbs?.ibsStateRate ?? 0), ibsCity: taxCents(reformBase, mapped.rules.ibsCbs?.ibsCityRate ?? 0), cbs: taxCents(reformBase, mapped.rules.ibsCbs?.cbsRate ?? 0) };
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
  const input = object(value), environment = fiscalEnvironment(input);
  const issuer = object(input.issuer), company = object(issuer.company), profile = object(issuer.profile), draft = object(input.draft);
  if (draft.environment !== input.environment || (profile.environment ?? "homologation") !== input.environment) refuse("Ambiente deve corresponder ao perfil e ao rascunho de homologação ou produção");
  const model = draft.model === 65 ? 65 : draft.model === 55 ? 55 : refuse("Modelo fiscal deve ser 55 ou 65", "tax_rule_scope");
  const purpose = draft.purpose == null ? 1 : [1, 2, 3, 4, 5, 6].includes(Number(draft.purpose)) && typeof draft.purpose === "number" ? draft.purpose as 1 | 2 | 3 | 4 | 5 | 6 : refuse("Finalidade fiscal não implementada no motor", "tax_rule_scope");
  const creditType = draft.creditType == null ? undefined : text(draft.creditType, "Tipo de crédito", 2), debitType = draft.debitType == null ? undefined : text(draft.debitType, "Tipo de débito", 2);
  if (purpose !== 4 && draft.returnDirection != null) refuse("Direção de devolução exige finalidade 4");
  const incoming = purpose === 5 || purpose === 4 && draft.returnDirection === "incoming";
  const returnDirection = purpose === 4
    ? draft.returnDirection === "incoming" || draft.returnDirection === "outgoing" ? draft.returnDirection : refuse("Devolução fiscal exige direção explícita", "tax_rule_scope")
    : undefined;
  const referencedAccessKeys = draft.referencedAccessKeys == null
    ? []
    : Array.isArray(draft.referencedAccessKeys)
      ? draft.referencedAccessKeys.map((key) => text(key, "Chave referenciada", 44))
      : refuse("Chaves referenciadas inválidas", "tax_rule_scope");
  if (profile.crt !== 1 && profile.crt !== 3 || profile.state !== "SP") refuse("Emissão fora do recorte: NF-e/NFC-e de SP, CRT 1 ou 3", "tax_rule_scope");
  const recipient = object(draft.recipient), state = text(recipient.state, "UF", 2);
  const foreign = state === "EX";
  const exportation = draft.exportation == null ? undefined : declaredObject(draft.exportation, ["kind", "exitState", "exportLocation", "dispatchLocation"]);
  if (exportation && (model !== 55 || purpose !== 1 || !["direct", "indirect", "trading"].includes(String(exportation.kind)) || foreign !== (exportation.kind !== "trading")) || foreign && !exportation) refuse("Modalidade de exportação incompatível com modelo, finalidade ou destinatário");
  if (exportation) {
    if (foreign) {
      if (!Object.hasOwn(UF_CODES, String(exportation.exitState))) refuse("Informe a UF brasileira de saída do país");
      text(exportation.exportLocation, "Local de exportação", 60);
      if (exportation.dispatchLocation != null) text(exportation.dispatchLocation, "Local de despacho", 60);
    } else if (exportation.exitState != null || exportation.exportLocation != null || exportation.dispatchLocation != null) refuse("Venda para trading no Brasil não declara saída do país");
  }
  if (foreign && (recipient.taxId !== "" || recipient.postalCode !== "" || recipient.municipalityCode !== "9999999" || typeof recipient.foreignId !== "string" || !/^[a-zA-Z0-9]{0,20}$/.test(recipient.foreignId) || !/^\d{4}$/.test(String(recipient.countryCode)) || ["1058", "0000"].includes(String(recipient.countryCode)))) refuse("Identificação e endereço estrangeiro inválidos");
  if (foreign) { text(recipient.countryName, "País", 60); text(recipient.cityName, "Cidade exterior", 60); }
  else if (recipient.foreignId != null || recipient.countryCode != null || recipient.countryName != null) refuse("País e identificação estrangeira exigem UF EX");
  const rawItems = draft.items;
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 990) refuse("Itens fiscais inválidos");
  const first = object(rawItems[0]);
  const normal = profile.crt === 3;
  text(draft.taxRuleReference, "Referência da instrução fiscal", 200);
  const contributionCodes = normal ? ["01", "02", "04", "05", "06", "07", "08", "09"] : ["04", "05", "06", "07", "08", "09"];
  if ((normal ? !["00", "40", "41", "50"].includes(String(first.icmsCst)) || first.csosn != null : !["102", "103", "300", "400"].includes(String(first.csosn)) || first.icmsCst != null) || !contributionCodes.includes(String(first.pisCst)) || !contributionCodes.includes(String(first.cofinsCst))) refuse("Classificação fora do recorte: exige regras ou alíquotas ainda não informadas no rascunho", "tax_rule_scope");
  if (!normal && draft.taxDeclaration != null) refuse("Declaração tributária disponível para emitente SP no CRT 3", "tax_rule_scope");
  if (normal && draft.taxDeclaration == null) refuse("CRT 3 exige declaração tributária explícita conforme a instrução do responsável fiscal", "tax_rule_scope");
  const declaration = normal ? declaredObject(draft.taxDeclaration, ["destinationIcmsRate", "destinationFcpRate", "recipientTaxpayerIndicator", "recipientTaxpayer", "recipientStateRegistration", "finalConsumer", "icmsRate", "pisRate", "cofinsRate", "ipiCst", "ipiFrameCode", "ipiRate", "ipiInIcmsBase", "icmsOutOfContributions", "ibsCbs"]) : null;
  const taxpayer = declaration ? declaredBoolean(declaration, "recipientTaxpayer") : false;
  const taxpayerIndicator = declaration?.recipientTaxpayerIndicator == null ? taxpayer ? "1" : "9" : text(declaration.recipientTaxpayerIndicator, "Indicador ICMS", 1);
  if (!["1", "2", "9"].includes(taxpayerIndicator) || taxpayer !== (taxpayerIndicator !== "9")) refuse("Indicador ICMS incompatível com a declaração de contribuinte");
  const finalConsumer = declaration ? declaredBoolean(declaration, "finalConsumer") : true;
  if (model === 65 && !finalConsumer) refuse("NFC-e modelo 65 exige operação com consumidor final", "tax_rule_scope");
  const stateRegistration = declaration?.recipientStateRegistration == null ? null : text(declaration.recipientStateRegistration, "IE do destinatário", 14);
  if (stateRegistration !== null && !/^\d{2,14}$/.test(stateRegistration) || taxpayerIndicator === "1" && !stateRegistration || taxpayerIndicator === "2" && stateRegistration !== null || !taxpayer && (!foreign && purpose !== 5 && purpose !== 6 && !finalConsumer || first.icmsCst === "50")) refuse("Declaração de contribuinte, inscrição estadual ou consumidor final incompatível");
  if (foreign && (taxpayer || stateRegistration)) refuse("Destinatário exterior não pode declarar IE brasileira");
  if (model === 65 && (taxpayerIndicator !== "9" || stateRegistration !== null)) refuse("NFC-e exige não contribuinte sem inscrição estadual");
  const icmsRate = declaration ? rate(declaration.icmsRate, first.icmsCst === "00") : 0;
  const interstate = !foreign && state !== "SP";
  if (normal && interstate && first.icmsCst === "00" && ![0.04, 0.07, 0.12].includes(icmsRate)) refuse("ICMS interestadual tributado exige alíquota declarada de 4%, 7% ou 12%");
  const difal = purpose !== 5 && purpose !== 6 && normal && interstate && !taxpayer && finalConsumer;
  if (difal && first.icmsCst !== "00") refuse("Venda interestadual a não contribuinte disponível somente com ICMS CST 00 e DIFAL declarado", "tax_rule_scope");
  const destinationIcms = declaration ? rate(declaration.destinationIcmsRate, difal) : 0;
  const destinationFcp = declaration ? rate(declaration.destinationFcpRate, difal) : 0;
  if (difal && destinationIcms < icmsRate) refuse("Alíquota interna do destino não pode ser menor que a interestadual neste recorte de DIFAL");
  const pisRate = declaration ? rate(declaration.pisRate, ["01", "02"].includes(String(first.pisCst))) : 0;
  const cofinsRate = declaration ? rate(declaration.cofinsRate, ["01", "02"].includes(String(first.cofinsCst))) : 0;
  const ipiCst = declaration?.ipiCst == null ? null : text(declaration.ipiCst, "CST do IPI", 2);
  if (ipiCst !== null && ![...IPI_TAXED_CSTS, ...IPI_UNTAXED_CSTS].includes(ipiCst)) refuse("CST do IPI fora do recorte");
  const ipiRate = declaration ? rate(declaration.ipiRate, ipiCst !== null && IPI_TAXED_CSTS.includes(ipiCst)) : 0;
  const ipiFrameCode = ipiCst === null ? "999" : text(declaration?.ipiFrameCode, "Enquadramento do IPI", 3);
  if (!/^\d{3}$/.test(ipiFrameCode) || ipiCst === null && declaration?.ipiFrameCode != null) refuse("Enquadramento do IPI incompatível com o CST declarado");
  const ibs = declaration ? declaredObject(declaration.ibsCbs, ["cst", "classCode", "ibsStateRate", "ibsCityRate", "cbsRate"]) : null;
  const immunity = foreign && ibs?.cst === "410" && ibs.classCode === "410004";
  if (ibs && !immunity && (ibs.cst !== "000" || ibs.classCode !== "000001")) refuse("IBS/CBS fora do recorte tributado integral 000/000001", "tax_rule_scope");
  const ibsCbs = ibs ? { cst: String(ibs.cst), classCode: String(ibs.classCode), ibsStateRate: rate(ibs.ibsStateRate, !immunity), ibsCityRate: rate(ibs.ibsCityRate, !immunity), cbsRate: rate(ibs.cbsRate, !immunity) } : null;
  const cfop = text(first.cfop, "CFOP", 4);
  if (exportation?.kind === "trading" && !["5501", "5502", "6501", "6502"].includes(cfop)) refuse("Venda para trading com fim específico de exportação exige CFOP 5501/5502 ou 6501/6502");
  const expectedPrefix = foreign ? "7" : incoming
    ? state === "SP" ? "1" : "2"
    : state === "SP" ? "5" : "6";
  if (!new RegExp(`^${expectedPrefix}[0-9]{3}$`).test(cfop)) refuse("CFOP incompatível com finalidade e destino");
  let cents = 0n;
  const freightMode = draft.freightMode == null ? "9" : text(draft.freightMode, "Modalidade de frete", 1);
  if (!["0", "1", "2", "3", "4", "9"].includes(freightMode)) refuse("Modalidade de frete inválida");
  const items = rawItems.map((raw) => {
    const item = object(raw);
    for (const field of ["csosn", "icmsCst", "pisCst", "cofinsCst", "cfop"]) if (item[field] !== first[field]) refuse("O recorte exige a mesma classificação fiscal por item; separe as operações");
    const quantity = decimal(item.quantity, 4), unitPrice = decimal(item.unitPrice, 10);
    const gross = text(item.grossTotal, "Total", 17);
    if (!/^(0|[1-9][0-9]{0,12})\.\d{2}$/.test(gross) || quantity <= 0 || unitPrice <= 0 || BigInt(gross.replace(".", "")) <= 0n || roundCents(quantity * unitPrice).toFixed(2) !== gross) refuse("Total do item diverge do cálculo exato do rascunho");
    const exactGross = (BigInt(String(item.quantity).replace(".", "")) * BigInt(String(item.unitPrice).replace(".", "")) + 500_000_000_000n) / 1_000_000_000_000n;
    if (formatCents(exactGross) !== gross) refuse("Total do item diverge do cálculo inteiro do rascunho");
    const freightAmount = optionalMoney(item.freightAmount), discountAmount = optionalMoney(item.discountAmount);
    const insuranceAmount = optionalMoney(item.insuranceAmount), otherAmount = optionalMoney(item.otherAmount);
    const commercial = exactGross + centsOf(freightAmount) + centsOf(insuranceAmount) + centsOf(otherAmount) - centsOf(discountAmount);
    if (centsOf(discountAmount) > exactGross || commercial <= 0n || commercial > NFE_MAX_CENTS) refuse("Desconto não pode superar o produto; total com frete deve ser positivo e respeitar o limite fiscal");
    if (freightAmount > 0 && freightMode === "9") refuse("Frete cobrado exige modalidade de transporte diferente de 9");
    cents += BigInt(gross.replace(".", ""));
    if (!Number.isInteger(item.origin) || Number(item.origin) < 0 || Number(item.origin) > 8) refuse("Origem inválida");
    let taxableUnit: string | undefined, taxableQuantity: number | undefined, taxableUnitPrice: number | undefined;
    if (foreign || item.taxableUnit != null || item.taxableQuantity != null || item.taxableUnitPrice != null) {
      taxableUnit = text(item.taxableUnit, "Unidade tributável do NCM", 6);
      taxableQuantity = decimal(item.taxableQuantity, 4); taxableUnitPrice = decimal(item.taxableUnitPrice, 10);
      const taxableCents = (BigInt(String(item.taxableQuantity).replace(".", "")) * BigInt(String(item.taxableUnitPrice).replace(".", "")) + 500_000_000_000n) / 1_000_000_000_000n;
      if (taxableQuantity <= 0 || taxableUnitPrice <= 0 || taxableCents !== exactGross) refuse("Quantidade e preço tributáveis devem corresponder ao total do produto");
    }
    const exportDetails = item.exportDetails == null ? [] : Array.isArray(item.exportDetails) ? item.exportDetails.map(raw => {
      const detail = declaredObject(raw, ["drawbackNumber", "exportRegistration", "referencedAccessKey", "exportedQuantity"]);
      const drawbackNumber = detail.drawbackNumber == null ? undefined : text(detail.drawbackNumber, "Ato concessório drawback", 20);
      if (drawbackNumber && INVALID_FISCAL_TEXT.test(drawbackNumber)) refuse("Ato concessório drawback inválido");
      const indirect = exportation?.kind === "indirect" || detail.exportRegistration != null || detail.referencedAccessKey != null || detail.exportedQuantity != null;
      const exportRegistration = indirect ? typeof detail.exportRegistration === "string" && /^\d{0,12}$/.test(detail.exportRegistration) ? detail.exportRegistration : refuse("Registro de exportação exige até 12 dígitos, vazio quando não existente") : undefined;
      const referencedAccessKey = indirect ? validKey(detail.referencedAccessKey) : undefined;
      const exportedQuantity = indirect ? decimal(detail.exportedQuantity, 4) : undefined;
      if (referencedAccessKey && referencedAccessKey.slice(20,22) !== "55" || exportedQuantity != null && exportedQuantity <= 0 || !indirect && !drawbackNumber) refuse("Detalhamento da exportação inválido");
      return { drawbackNumber, exportRegistration, referencedAccessKey, exportedQuantity };
    }) : refuse("Detalhamento da exportação inválido");
    const exported = exportDetails.reduce((sum, detail) => sum + BigInt((detail.exportedQuantity ?? 0).toFixed(4).replace(".", "")), 0n);
    if (exportDetails.length > 500 || !foreign && exportDetails.length || exportation?.kind === "indirect" && !exportDetails.length || exported > BigInt(String(item.quantity).replace(".", ""))) refuse("Quantidade ou referências de exportação incompatíveis com o item");
    const referencedDfe = item.referencedDfe == null ? undefined : (() => {
      const ref = declaredObject(item.referencedDfe, ["accessKey", "itemNumber"]);
      return { accessKey: validKey(ref.accessKey), itemNumber: ref.itemNumber == null ? undefined : whole(ref.itemNumber, 990) };
    })();
    return { referencedDfe, taxableUnit, taxableQuantity, taxableUnitPrice, exportDetails, freightAmount, discountAmount, insuranceAmount, otherAmount, additionalInfo: item.additionalInfo == null ? null : text(item.additionalInfo, "Informações do item", 500), code: text(item.code, "Código", 60), name: text(item.description, "Descrição", 120), ncm: text(item.ncm, "NCM", 8), cest: null, origin: Number(item.origin), unit: text(item.unit, "Unidade", 6), quantity, unitPrice, ipiRate };
  });
  const productsTotal = text(draft.productsTotal, "Total de produtos", 17);
  if (!/^(0|[1-9][0-9]{0,12})\.\d{2}$/.test(productsTotal) || cents !== BigInt(productsTotal.replace(".", "")) || cents > BigInt(Number.MAX_SAFE_INTEGER)) refuse("Total de produtos diverge da soma dos itens");
  const taxId = text(issuer.taxId, "CNPJ", 14);
  if (company.taxId !== taxId || !/^\d{14}$/.test(taxId)) refuse("CNPJ do emitente diverge do cadastro");
  const recipientTaxId = foreign ? "" : text(recipient.taxId, "Documento", 14);
  if (!Array.isArray(draft.payments) || !draft.payments.length || draft.payments.length > 100) refuse("Informe as formas de pagamento declaradas na nota; não são inferidas dos recebimentos", "payments_required");
  const payments = draft.payments.map((raw) => {
    const payment = object(raw), code = text(payment.code, "Forma de pagamento", 2);
    if (!["01", "03", "04", "15", "16", "17", "18", "90", "99"].includes(code)) refuse("Forma de pagamento fora do recorte fiscal");
    const amount = decimal(payment.amount, 2);
    return { code, description: payment.description == null ? null : text(payment.description, "Descrição do pagamento", 60), amount };
  });
  const changeAmount = draft.changeAmount == null ? 0 : optionalMoney(draft.changeAmount);
  const emissionType = draft.emissionType == null ? "1" : text(draft.emissionType, "Modalidade de emissão", 1);
  if (!(model === 65 ? ["1", "3", "4", "9"] : ["1"]).includes(emissionType)) refuse("Modalidade de emissão incompatível com o modelo fiscal", "tax_rule_scope");
  if (model !== 65 && changeAmount !== 0) refuse("Troco somente pode ser declarado na NFC-e modelo 65", "tax_rule_scope");
  const presenceIndicator = draft.presenceIndicator ?? 9;
  if (typeof presenceIndicator !== "number" || ![0, 1, 2, 3, 4, 5, 9].includes(presenceIndicator)) refuse("Indicador de presença inválido");
  if (model === 65 && draft.presenceIndicator != null && ![1, 4, 5].includes(presenceIndicator)) refuse("NFC-e exige presença 1, 4 ou 5");
  const printType = draft.printType ?? (model === 65 ? 4 : 1);
  if (typeof printType !== "number" || !(model === 65 ? [4] : [1, 2, 6]).includes(printType)) refuse("Apresentação do DANFE incompatível com o modelo");
  const issuedAt = date(input.issuedAt);
  if (draft.issuedAt != null && date(draft.issuedAt) !== issuedAt) refuse("Data de emissão diverge da data fixada no documento");
  const departureAt = draft.departureAt == null ? undefined : date(draft.departureAt);
  if (departureAt && (model === 65 || new Date(departureAt) < new Date(issuedAt))) refuse("Data de saída incompatível com o modelo ou anterior à emissão");
  if (draft.finalConsumer != null && (typeof draft.finalConsumer !== "boolean" || declaration && draft.finalConsumer !== finalConsumer)) refuse("Consumidor final diverge da declaração tributária");
  const effectiveFinalConsumer = draft.finalConsumer == null ? finalConsumer : draft.finalConsumer as boolean;
  if (model === 65 && !effectiveFinalConsumer) refuse("NFC-e exige consumidor final");
  const complement = recipient.complement == null ? undefined : text(recipient.complement, "Complemento", 60);
  const phone = recipient.phone == null ? undefined : text(recipient.phone, "Telefone", 14);
  const email = recipient.email == null ? undefined : text(recipient.email, "E-mail", 60);
  if (phone && !/^\d{6,14}$/.test(phone) || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) refuse("Telefone ou e-mail do destinatário inválido");
  const noPayment = payments.some((payment) => payment.code === "90");
  if (purpose === 3 && (!noPayment || payments.length !== 1)) refuse("Nota de ajuste exige meio 90, sem pagamento");
  const mapped: NfeInput = {
    exportation: exportation as NfeInput["exportation"],
    environment, model, purpose, creditType, debitType, presenceIndicator, printType, departureAt, returnDirection, referencedAccessKeys, emissionType: emissionType as NfeInput["emissionType"], changeAmount, freightMode: freightMode as NfeInput["freightMode"], transport: { carrier: null, volumes: null, volumeKind: null, netWeight: null, grossWeight: null }, delivery: null,
    series: whole(profile.series, 999), number: whole(input.number, 999_999_999), randomCode: text(input.randomCode, "Código aleatório", 8), issuedAt,
    issuer: { cnpj: taxId, legalName: text(company.legalName, "Razão social", 60), stateRegistration: text(profile.stateRegistration, "IE", 14), taxRegime: normal ? 3 : 1, street: text(company.street), number: text(company.number), district: text(company.district), cityCode: text(profile.municipalityCode), city: city("SP", profile.municipalityCode), uf: "SP", cep: text(company.postalCode, "CEP", 8) },
    recipient: { foreignId: foreign ? String(recipient.foreignId) : undefined, countryCode: foreign ? String(recipient.countryCode) : undefined, countryName: foreign ? String(recipient.countryName) : undefined, complement, phone, email, kind: recipientTaxId.length === 11 ? "PF" : "PJ", document: recipientTaxId, name: text(recipient.legalName, "Destinatário", 60), stateRegistration, taxpayer, street: text(recipient.street), number: text(recipient.number), district: text(recipient.district), cityCode: text(recipient.municipalityCode), city: foreign ? text(recipient.cityName, "Cidade exterior", 60) : city(state, recipient.municipalityCode), uf: state, cep: foreign ? "" : text(recipient.postalCode, "CEP", 8) },
    rules: { operationNature: text(draft.operationNature, "Natureza", 60), cfopInternal: foreign ? cfop : `${incoming ? "1" : "5"}${cfop.slice(1)}`, cfopInterstate: foreign ? cfop : `${incoming ? "2" : "6"}${cfop.slice(1)}`, cfopInterstateNonTaxpayer: foreign ? cfop : `${incoming ? "2" : "6"}${cfop.slice(1)}`, icmsCode: String(normal ? first.icmsCst : first.csosn), ipiCst, ipiFrameCode, pisCst: String(first.pisCst), pisRate, cofinsCst: String(first.cofinsCst), cofinsRate, finalConsumer: effectiveFinalConsumer, ipiInIcmsBase: declaration ? declaredBoolean(declaration, "ipiInIcmsBase") : false, icmsOutOfContributions: declaration ? declaredBoolean(declaration, "icmsOutOfContributions") : false, additionalInfo: draft.additionalInformation ? text(draft.additionalInformation, "Informações complementares", 5000) : null, ibsCbs },
    items, icmsRate, destination: { internalIcms: destinationIcms, fcp: destinationFcp },
    payments, software: "ERP Next 0.1",
  };
  mapped.recipient.taxpayerIndicator = taxpayerIndicator as "1" | "2" | "9";
  const optionalText = (value: unknown, label: string, max = 60) => value == null ? null : text(value, label, max);
  if (draft.transport != null) {
    const transport = declaredObject(draft.transport, ["carrierTaxId", "carrierName", "stateRegistration", "address", "city", "state", "plate", "vehicleState", "rntc", "volumes", "volumeKind", "volumeNumber", "brand", "netWeight", "grossWeight"]);
    if (freightMode === "9") refuse("Dados de transporte exigem modalidade de frete diferente de 9");
    const carrierDocument = optionalText(transport.carrierTaxId, "Documento da transportadora", 14);
    const carrierName = optionalText(transport.carrierName, "Nome da transportadora");
    if (!!carrierDocument !== !!carrierName || carrierDocument && !/^\d{11}(?:\d{3})?$/.test(carrierDocument)) refuse("Documento e nome da transportadora devem ser informados juntos");
    const carrierState = optionalText(transport.state, "UF da transportadora", 2);
    const vehicleState = optionalText(transport.vehicleState, "UF do veículo", 2);
    const plate = optionalText(transport.plate, "Placa", 7);
    if (carrierState && !UF_CODES[carrierState] || vehicleState && !UF_CODES[vehicleState] || plate && !/^[A-Z0-9]{7}$/.test(plate) || vehicleState && !plate) refuse("Placa ou UF do transporte inválida");
    const stateRegistration = optionalText(transport.stateRegistration, "IE da transportadora", 14);
    if (stateRegistration && !carrierState) refuse("Transportadora com IE exige UF");
    const netWeight = transport.netWeight == null ? null : decimal(transport.netWeight, 3);
    const grossWeight = transport.grossWeight == null ? null : decimal(transport.grossWeight, 3);
    if (netWeight !== null && grossWeight !== null && netWeight > grossWeight) refuse("Peso líquido não pode superar o bruto");
    if (transport.volumes != null && (typeof transport.volumes !== "number" || !Number.isInteger(transport.volumes) || transport.volumes < 0 || transport.volumes > 999999999)) refuse("Quantidade de volumes inválida");
    mapped.transport = { carrier: carrierDocument && carrierName ? { kind: carrierDocument.length === 11 ? "PF" : "PJ", document: carrierDocument, name: carrierName, stateRegistration, address: optionalText(transport.address, "Endereço da transportadora"), city: optionalText(transport.city, "Município da transportadora"), uf: carrierState } : null,
      volumes: transport.volumes as number | null ?? null, volumeKind: optionalText(transport.volumeKind, "Espécie"), volumeNumber: optionalText(transport.volumeNumber, "Numeração"), brand: optionalText(transport.brand, "Marca"), netWeight, grossWeight,
      vehicle: plate ? { plate, uf: vehicleState, rntc: optionalText(transport.rntc, "RNTC", 20) } : null };
  }
  if (draft.authorizedXml != null) {
    if (!Array.isArray(draft.authorizedXml) || draft.authorizedXml.length > 10) refuse("Informe até 10 pessoas autorizadas");
    mapped.xmlAccess = draft.authorizedXml.map(raw => {
      const entry = declaredObject(raw, ["taxId", "name"]), document = text(entry.taxId, "Documento autorizado", 14);
      if (!/^\d{11}(?:\d{3})?$/.test(document)) refuse("Documento autorizado inválido");
      return document;
    });
    if (new Set(mapped.xmlAccess).size !== mapped.xmlAccess.length) refuse("Documentos autorizados não podem se repetir");
  }
  if (draft.intermediary != null) {
    const intermediary = declaredObject(draft.intermediary, ["taxId", "registration"]);
    const taxId = text(intermediary.taxId, "CNPJ do intermediador", 14);
    if (!/^\d{14}$/.test(taxId) || ![2, 3, 4, 9].includes(presenceIndicator)) refuse("Intermediador exige CNPJ e operação não presencial");
    mapped.intermediary = { taxId, registration: text(intermediary.registration, "Cadastro no intermediador", 60) };
  }
  if (draft.retentions != null) {
    const retentions = declaredObject(draft.retentions, ["pis", "cofins", "csll", "incomeTaxBase", "incomeTax", "socialSecurityBase", "socialSecurity"]);
    mapped.retentions = Object.fromEntries(Object.entries(retentions).filter(([, value]) => value != null).map(([key, value]) => [key, optionalMoney(value)]));
  }
  mapped.taxAuthorityInformation = optionalText(draft.taxAuthorityInformation, "Informações do fisco", 2000);
  if (draft.installments != null) {
    if (!Array.isArray(draft.installments) || draft.installments.length > 120 || model === 65 && draft.installments.length) refuse("Parcelas exigem NF-e modelo 55 e limite de 120");
    mapped.installments = draft.installments.map(raw => {
      const installment = declaredObject(raw, ["number", "dueDate", "amount"]), number = text(installment.number, "Número da parcela", 3), dueDate = ibptDate(installment.dueDate), amount = optionalMoney(installment.amount);
      if (!/^\d{3}$/.test(number) || amount <= 0) refuse("Número ou valor da parcela inválido");
      return { number, dueDate, amount };
    });
    if (new Set(mapped.installments.map(item => item.number)).size !== mapped.installments.length) refuse("Número de parcela repetido");
    if (mapped.installments.length && mapped.installments.reduce((sum, item) => sum + centsOf(item.amount), 0n) !== centsOf(nfeTotals(mapped).invoice)) refuse("Soma das parcelas diverge do total da NF-e");
  }
  const financialProblems = financialNoteProblems(mapped);
  if (financialProblems.length) refuse(financialProblems.join(" "), "tax_rule_scope");
  assertExactTaxes(mapped, cents);
  const approximateTaxes = mapIbptSnapshot(input, draft, mapped);
  if (approximateTaxes) mapped.approximateTaxes = approximateTaxes;
  const invoice = nfeTotals(mapped).invoice.toFixed(2);
  const paymentCents = payments.reduce((sum, payment) => sum + centsOf(payment.amount), 0n);
  const expectedPayment = nfeTotals(mapped).invoice + changeAmount;
  if (noPayment ? payments.length !== 1 || payments[0].amount !== 0 || changeAmount !== 0 : formatCents(paymentCents) !== expectedPayment.toFixed(2) || roundCents(payments.reduce((sum, payment) => sum + payment.amount, 0)).toFixed(2) !== expectedPayment.toFixed(2) || roundCents(payments.reduce((sum, payment) => sum + payment.amount, 0) - invoice).toFixed(2) !== changeAmount.toFixed(2)) refuse("Valores das formas de pagamento ou troco divergem do total da NFC-e");
  if (mapped.printType === 6) {
    const endpoints = object(draft.simplifiedDanfe);
    for (const name of ["qrCodeUrl", "accessKeyUrl"]) {
      const url = new URL(text(endpoints[name], "URL oficial do DANFE Simplificado Tipo 2", 300));
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/(^|\.)gov\.br$/.test(url.hostname)) refuse("Informe URLs oficiais HTTPS da UF para o DANFE Simplificado Tipo 2");
    }
    const problems = nfeProblems(mapped);
    if (problems.length) refuse(problems.join(" "));
  } else if (draft.simplifiedDanfe != null) refuse("Endereços de consulta simplificada exigem impressão tipo 6");
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
  const input = object(value);
  if (operation === "inspect-cte") {
    try { return { ...await inspectReceivedCte(input as { xml: string; companyTaxId: string; environment: "homologation" }) }; }
    catch (error) {
      if (error instanceof CteInspectionError) refuse(error.message, error.reason === "invalid" ? "invalid_cte_xml" : error.reason === "unsupported" ? "cte_profile_unsupported" : "cte_layout_unavailable");
      throw error;
    }
  }
  if (operation === "inspect-nfse") {
    try { return { ...await inspectReceivedNationalNfse(input as { xml: string; recipientTaxId: string }) }; }
    catch (error) {
      if (error instanceof NationalNfseXmlError) refuse(error.message, error.code === "invalid" ? "invalid_nfse_xml" : "nfse_layout_unavailable");
      throw error;
    }
  }
  const environment = fiscalEnvironment(input);
  if (!["prepare", "authorize", "consult", "event", "void"].includes(operation)) homologation(input);
  if (operation === "prepare") {
    const mapped = mapDraft(input), credentials = material(input, mapped.issuer.cnpj);
    const generated = buildNfeXml(mapped), signedXml = signNfeXml(generated.xml, signingKeyOf(credentials.pfx, credentials.passphrase));
    await assertFiscalXml(signedXml, "nfe");
    if (mapped.model === 65) {
      const qr = await createNfceQrPayload({ signedXml, profile: input.nfce as Parameters<typeof createNfceQrPayload>[0]["profile"] });
      return { accessKey: generated.key, signedXml, qrCode: qr.payload, qrMode: qr.mode, qrVersion: qr.version, qrSourceSha256: qr.sourceSha256 };
    }
    if (mapped.printType === 6) {
      const endpoints = declaredObject(object(input.draft).simplifiedDanfe, ["qrCodeUrl", "accessKeyUrl"]);
      const supplemented = await supplementSimplifiedNfe({ signedXml, endpoints: { qrCodeUrl: text(endpoints.qrCodeUrl, "URL QR Code", 300), accessKeyUrl: text(endpoints.accessKeyUrl, "URL consulta por chave", 300) } });
      return { accessKey: generated.key, signedXml: supplemented.xml, qrCode: supplemented.qrCodeUrl, qrMode: "online", qrVersion: "3" };
    }
    return { accessKey: generated.key, signedXml };
  }
  if (operation === "authorize" || operation === "consult") {
    const key = validKey(input.accessKey), credentials = material(input, key.slice(6, 20));
    if (key.slice(0, 2) !== "35") refuse("Autorizador ainda restrito a São Paulo");
    let signed: string | undefined;
    if (operation === "authorize" || input.signedXml != null) {
      signed = text(input.signedXml, "XML assinado", 1_048_576);
      if (!signed.includes(`Id="NFe${key}"`) || !signed.includes(`<tpAmb>${environment === "producao" ? "1" : "2"}</tpAmb>`)) refuse("XML diverge da chave ou do ambiente");
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
      ? await send(authorizationUrl("SP", environment), AUTHORIZATION_ACTION, authorizationEnvelope(signed!, String(input.batch ?? "1")), credentials)
      : await send(consultUrl("SP", environment), CONSULT_ACTION, consultEnvelope(key, environment), credentials);
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
  if (operation === "distribute-cte") {
    const cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    return queryCteDistribution({ environment: "homologation", companyTaxId: cnpj, authorState: text(input.authorState, "UF do ator", 2), lastNsu: text(input.lastNsu, "NSU", 15) }, credentials, send);
  }
  if (operation === "event" || operation === "manifest") {
    const key = validKey(input.accessKey), cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    const signingKey = signingKeyOf(credentials.pfx, credentials.passphrase);
    let xml: string, endpoint: string;
    if (operation === "event") {
      if (key.slice(6, 20) !== cnpj || key.slice(0, 2) !== "35") refuse("Evento não pertence ao emitente SP");
      if (input.kind !== "cancelamento" && input.kind !== "correcao") refuse("Tipo de evento inválido");
      xml = eventXml({ kind: input.kind, environment, accessKey: key, cnpj, at: date(input.issuedAt), sequence: whole(input.sequence, 20), protocol: typeof input.protocol === "string" ? input.protocol : undefined, text: text(input.text, "Texto do evento", 1000) }).xml;
      endpoint = eventUrl("SP", environment);
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
    if (input.state === "SP") refuse("Inutilização de NF-e e NFC-e não se aplica a São Paulo desde 01/11/2026; mantenha a numeração sequencial e registre a quebra na escrituração", "void_not_applicable");
    refuse("Inutilização ainda restrita a São Paulo", "void_not_applicable");
    const cnpj = text(input.issuerTaxId, "CNPJ", 14), credentials = material(input, cnpj);
    const year = String(input.year);
    if (!/^\d{2}$/.test(year) && !/^20\d{2}$/.test(year)) refuse("Ano de inutilização inválido");
    const generated = voidXml({ environment, stateCode: UF_CODES.SP, year: year.slice(-2), cnpj, series: whole(input.series, 999), first: whole(input.first, 999_999_999), last: whole(input.last, 999_999_999), reason: text(input.text, "Justificativa", 255) });
    const signed = signVoidXml(generated.xml, signingKeyOf(credentials.pfx, credentials.passphrase));
    await assertFiscalXml(signed, "inutilizacao");
    const rawXml = await send(voidUrl("SP", environment), VOID_ACTION, voidEnvelope(signed), credentials);
    const receipt = /<retInutNFe\b[\s\S]*?<\/retInutNFe>/.exec(rawXml)?.[0];
    const xml = receipt ? `<procInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${signed}${receipt}</procInutNFe>` : signed;
    return { ...parseVoid(rawXml), xml, rawXml };
  }
  return refuse("Operação fiscal desconhecida");
}
