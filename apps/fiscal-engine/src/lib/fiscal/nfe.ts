import { roundCents } from "@/lib/pricing/money";

/**
 * The NF-e (model 55, layout 4.00) of a sale, as XML ready to be signed. Pure:
 * no database, no certificate, no network. Every tax code and rate comes in
 * `rules` and in the items, from the tables the company edits; nothing fiscal
 * is decided here beyond the arithmetic the layout prescribes.
 */

/** A problem the company can fix in a register: the message goes to the screen as it is. */
export class NfeError extends Error {}

/** IBGE code of each state: the first two digits of the access key. */
export const UF_CODES: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26",
  AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

/** The issuing state encoded in the first two positions of an NF-e access key. */
export function accessKeyUf(key: string): string | null {
  const stateCode = key.slice(0, 2);
  return Object.entries(UF_CODES).find(([, code]) => code === stateCode)?.[0] ?? null;
}

export type NfeAddress = {
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  /** IBGE code of the city, seven digits. */
  cityCode: string;
  city: string;
  uf: string;
  /** Eight digits. */
  cep: string;
  phone?: string | null;
};

export type NfeIssuer = NfeAddress & {
  cnpj: string;
  legalName: string;
  stateRegistration: string;
  /** 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 Regime normal. */
  taxRegime: 1 | 2 | 3;
};

export type NfeRecipient = NfeAddress & {
  kind: "PJ" | "PF";
  /** CNPJ or CPF, digits only. */
  document: string;
  name: string;
  /** Digits, or `null` for who has none or is exempt. */
  stateRegistration: string | null;
  /** Contributor of ICMS: a company with a state registration in numbers. */
  taxpayer: boolean;
  email?: string | null;
};

/**
 * Where the goods go when it is not the recipient's address (group `entrega`).
 * The document is of who receives there; the recipient's when nobody else was named.
 */
export type NfeDelivery = NfeAddress & {
  kind: "PJ" | "PF";
  document: string;
  name: string | null;
};

/** The fiscal rules of the operation: the table the accountant fills in, by product line. */
export type NfeRules = {
  operationNature: string;
  cfopInternal: string;
  cfopInterstate: string;
  /** Sale to another state for who does not pay ICMS (final consumer). */
  cfopInterstateNonTaxpayer: string;
  /** CST of ICMS (regime normal) or CSOSN (Simples), as the regime of the issuer asks. */
  icmsCode: string;
  /** `null`: the invoice has no IPI group. */
  ipiCst: string | null;
  ipiFrameCode: string;
  pisCst: string;
  /** As a fraction. */
  pisRate: number;
  cofinsCst: string;
  cofinsRate: number;
  /** The buyer uses the goods (does not resell): what brings the DIFAL and the IPI into the ICMS base. */
  finalConsumer: boolean;
  /** Whether the IPI is part of the ICMS base in a sale to a final consumer. */
  ipiInIcmsBase: boolean;
  /** The ICMS of the operation leaves the base of PIS and COFINS (Lei 14.592/2023). */
  icmsOutOfContributions: boolean;
  additionalInfo: string | null;
  /**
   * IBS and CBS of the tax reform (NT 2025.002): the classification the
   * accountant gives and the rates of the year. `null`: the invoice has no
   * IBSCBS group, which the regime normal may not do since 2026-08-03.
   */
  ibsCbs: { cst: string; classCode: string; ibsStateRate: number; ibsCityRate: number; cbsRate: number } | null;
};

export type NfeItem = {
  code: string;
  name: string;
  ncm: string;
  cest: string | null;
  /** Origin of the goods, 0 to 8. */
  origin: number;
  unit: string;
  quantity: number;
  /** Price of one unit after the discount of the order, without IPI. */
  unitPrice: number;
  /** As a fraction: the IPI of the table version of the order. */
  ipiRate: number;
};

export type NfePayment = {
  /** `tPag` of the layout: 01 dinheiro, 03 crédito, 04 débito, 15 boleto, 16 depósito, 17 PIX, 18 transferência, 99 outros. */
  code: string;
  /** Required by the layout when the code is 99. */
  description: string | null;
  amount: number;
};

const NON_INTEGRATED_ELECTRONIC_PAYMENTS = new Set(["03", "04", "17"]);

/** The ways of freight of the layout (`modFrete`), with the official wording. */
export const FREIGHT_MODES = [
  ["0", "Contratação do frete por conta do remetente (CIF)"],
  ["1", "Contratação do frete por conta do destinatário (FOB)"],
  ["2", "Contratação do frete por conta de terceiros"],
  ["3", "Transporte próprio por conta do remetente"],
  ["4", "Transporte próprio por conta do destinatário"],
  ["9", "Sem ocorrência de transporte"],
] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number][0];

/** Who carries and what goes. Everything is optional in the layout: what is `null` is left out of the invoice. */
export type NfeTransport = {
  carrier: { kind: "PJ" | "PF"; document: string; name: string; stateRegistration: string | null; address: string | null; city: string | null; uf: string | null } | null;
  volumes: number | null;
  /** Kind of volume: box, pallet, crate… */
  volumeKind: string | null;
  /** Kilos. */
  netWeight: number | null;
  grossWeight: number | null;
};

export type NfeInput = {
  environment: "homologacao" | "producao";
  transport: NfeTransport;
  /** `modFrete`: who hires the freight. */
  freightMode: FreightMode;
  series: number;
  number: number;
  /** `cNF`: eight random digits, different from the number. */
  randomCode: string;
  /** `AAAA-MM-DDTHH:MM:SS-03:00`. */
  issuedAt: string;
  issuer: NfeIssuer;
  recipient: NfeRecipient;
  /** `null`: the goods go to the recipient's address. */
  delivery: NfeDelivery | null;
  rules: NfeRules;
  items: NfeItem[];
  /** ICMS of the operation, as a fraction: the internal rate inside the state, the outbound rate to another. */
  icmsRate: number;
  /** The destination's internal rate and poverty fund, for the DIFAL of a sale to a non taxpayer of another state. */
  destination: { internalIcms: number; fcp: number };
  payments: NfePayment[];
  /** Name and version of this system, as `verProc`. */
  software: string;
};

const HOMOLOGATION_NAME = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
const NAMESPACE = "http://www.portalfiscal.inf.br/nfe";

const onlyDigits = (text: string) => text.replace(/\D/g, "");
const money = (value: number) => roundCents(value).toFixed(2);
const rate = (value: number) => (Math.round(value * 1e6) / 1e4).toFixed(4);

/** Text as the layout takes it: no line breaks, no doubled spaces, no edges, cut at the size of the field. */
function clean(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max).trim();
}
/** Only what a text node needs, which is also its canonical form: the signature is calculated over these exact bytes. */
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `<name>value</name>`, or nothing for `null`: an empty tag is refused by the schema. */
function tag(name: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<${name}>${escape(String(value))}</${name}>`;
}
const group = (name: string, inner: string, attributes = "") => (inner === "" ? "" : `<${name}${attributes}>${inner}</${name}>`);

/** A CNPJ as the layout takes it since NT 2026.004: letters allowed in the first twelve positions, two check digits. */
export const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/;
/** The 44 positions of an access key: only the CNPJ of the issuer (positions 7 to 18) may carry letters (NT Conjunta 2025.001, item 5). */
export const ACCESS_KEY_PATTERN = /^\d{6}[0-9A-Z]{12}\d{26}$/;

/**
 * Check digit of the access key: modulus 11, weights 2 to 9 from the right.
 * Each position counts as its ASCII code less 48, so a digit is itself and a
 * letter of an alphanumeric CNPJ is 17 to 42 (NT Conjunta 2025.001, item 5).
 */
export function accessKeyDigit(key43: string): string {
  if (!/^\d{6}[0-9A-Z]{12}\d{25}$/.test(key43)) throw new Error("A chave de acesso tem 43 posições antes do verificador, com letras só no CNPJ.");
  let sum = 0;
  for (let index = 0; index < 43; index += 1) sum += (key43.charCodeAt(42 - index) - 48) * (2 + (index % 8));
  const digit = 11 - (sum % 11);
  return digit >= 10 ? "0" : String(digit);
}

/** The codes rule B03-10 refuses (rejection 897) besides the number of the invoice itself: repeated and sequential digits. */
const WEAK_RANDOM_CODES = new Set([
  ...Array.from({ length: 10 }, (_, digit) => String(digit).repeat(8)),
  ...Array.from({ length: 10 }, (_, start) => Array.from({ length: 8 }, (_, index) => (start + index) % 10).join("")),
]);

/** Whether `cNF` is one SEFAZ accepts for the invoice of this number (rule B03-10 of NT 2019.001). */
export function isAcceptableRandomCode(code: string, number: number): boolean {
  return /^\d{8}$/.test(code) && !WEAK_RANDOM_CODES.has(code) && Number(code) !== number;
}

/** The 44 digits that identify the invoice: state, year and month, CNPJ, model, series, number, way of issuing, random code and check digit. */
export function accessKey(input: Pick<NfeInput, "issuer" | "issuedAt" | "series" | "number" | "randomCode">): string {
  const uf = UF_CODES[input.issuer.uf];
  if (!uf) throw new NfeError(`Estado do emitente inválido: ${input.issuer.uf}.`);
  if (!isAcceptableRandomCode(input.randomCode, input.number)) throw new Error("O código aleatório da nota tem oito dígitos, diferentes do número da nota e sem sequência óbvia.");
  const body = [
    uf,
    input.issuedAt.slice(2, 4) + input.issuedAt.slice(5, 7),
    input.issuer.cnpj,
    "55",
    String(input.series).padStart(3, "0"),
    String(input.number).padStart(9, "0"),
    "1",
    input.randomCode,
  ].join("");
  return body + accessKeyDigit(body);
}

function address(prefix: "enderEmit" | "enderDest", place: NfeAddress): string {
  return group(
    prefix,
    tag("xLgr", clean(place.street, 60)) +
      tag("nro", clean(place.number, 60)) +
      tag("xCpl", place.complement ? clean(place.complement, 60) : null) +
      tag("xBairro", clean(place.district, 60)) +
      tag("cMun", place.cityCode) +
      tag("xMun", clean(place.city, 60)) +
      tag("UF", place.uf) +
      tag("CEP", place.cep) +
      tag("cPais", "1058") +
      tag("xPais", "BRASIL") +
      tag("fone", place.phone ? onlyDigits(place.phone).slice(0, 14) : null),
  );
}

/**
 * The state the goods physically go to: the place of delivery when there is
 * one, the recipient's otherwise. It is what makes the operation internal or
 * interstate and says which state the DIFAL belongs to: the layout validates
 * `idDest` and the group `ICMSUFDest` by `entrega/UF` when it is informed
 * (rules E12-30, E12-40, NA01-20 and NA01-30 of MOC 7.0, Anexo I).
 */
export const destinationUf = (input: Pick<NfeInput, "recipient" | "delivery">): string => input.delivery?.uf ?? input.recipient.uf;

/** The CSTs of IPI that carry base, rate and amount; every other one only names itself. */
export const IPI_TAXED_CSTS = ["00", "49", "50", "99"];
/** The CSTs of IPI the schema takes without figures (group IPINT). */
export const IPI_UNTAXED_CSTS = ["01", "02", "03", "04", "05", "51", "52", "53", "54", "55"];
/** The CSTs of PIS and COFINS this system writes, as the schema groups them: by rate (01, 02), without figures (04 to 09) and "other operations" (49 to 99). 03 is by quantity: not issued here. */
export const CONTRIBUTION_RATE_CSTS = ["01", "02"];
export const CONTRIBUTION_UNTAXED_CSTS = ["04", "05", "06", "07", "08", "09"];
export const CONTRIBUTION_OTHER_CSTS = ["49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "70", "71", "72", "73", "74", "75", "98", "99"];
/** Origins of imported goods: they leave the state at 4% (Resolução do Senado 13/2012; rules NA09-10 and NA09-20). */
const IMPORTED_ORIGINS = [1, 2, 3, 8];
/** South and Southeast except Espírito Santo: from them to the other states the rate is 7%, 12% in every other case (rule NA09-30). */
const SOUTH_AND_SOUTHEAST = ["MG", "PR", "RJ", "RS", "SC", "SP"];

/** The interstate rate the layout demands in the group of the DIFAL, by the origin of the goods and the two states. */
export function interstateRate(origin: number, fromUf: string, toUf: string): number {
  if (IMPORTED_ORIGINS.includes(origin)) return 0.04;
  return SOUTH_AND_SOUTHEAST.includes(fromUf) && !SOUTH_AND_SOUTHEAST.includes(toUf) ? 0.07 : 0.12;
}

/** What is missing or wrong before any XML is written. Every problem at once, each naming the register that fixes it. */
export function nfeProblems(input: NfeInput): string[] {
  const problems: string[] = [];
  const { issuer, recipient, rules } = input;
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  // The CNPJ may have letters since July 2026 (NT 2026.004); the register already checked its digits.
  need(CNPJ_PATTERN.test(issuer.cnpj), "Empresa: CNPJ com 14 posições (Parâmetros → Fiscal).");
  need(/^\d{2,14}$/.test(issuer.stateRegistration), "Empresa: inscrição estadual (Parâmetros → Fiscal).");
  need(issuer.legalName.trim().length >= 2, "Empresa: razão social (Parâmetros → Fiscal).");
  need(/^\d{7}$/.test(issuer.cityCode) && /^\d{8}$/.test(issuer.cep) && Boolean(UF_CODES[issuer.uf]), "Empresa: endereço com código do município no IBGE, UF e CEP (Parâmetros → Fiscal).");
  // Rule C10-20 (rejection 273): the city belongs to the state of the issuer.
  need(!/^\d{7}$/.test(issuer.cityCode) || !UF_CODES[issuer.uf] || issuer.cityCode.slice(0, 2) === UF_CODES[issuer.uf], "Empresa: o código do município no IBGE não é do estado informado (Parâmetros → Fiscal).");
  need(issuer.street.trim() !== "" && issuer.number.trim() !== "" && issuer.district.trim() !== "" && issuer.city.trim() !== "", "Empresa: rua, número, bairro e cidade (Parâmetros → Fiscal).");

  need(recipient.kind === "PJ" ? CNPJ_PATTERN.test(recipient.document) : /^\d{11}$/.test(recipient.document), "Cliente: CNPJ ou CPF completo.");
  need(recipient.name.trim().length >= 2, "Cliente: nome ou razão social.");
  need(/^\d{7}$/.test(recipient.cityCode), "Cliente: código do município no IBGE (cadastro do cliente).");
  need(/^\d{8}$/.test(recipient.cep) && Boolean(UF_CODES[recipient.uf]), "Cliente: CEP e UF.");
  need(recipient.street.trim() !== "" && recipient.number.trim() !== "" && recipient.district.trim() !== "" && recipient.city.trim() !== "", "Cliente: rua, número, bairro e cidade.");
  need(!recipient.taxpayer || /^\d{2,14}$/.test(recipient.stateRegistration ?? ""), "Cliente contribuinte: inscrição estadual em números.");

  const delivery = input.delivery;
  if (delivery) {
    need(delivery.kind === "PJ" ? CNPJ_PATTERN.test(delivery.document) : /^\d{11}$/.test(delivery.document), "Local de entrega: CNPJ ou CPF de quem recebe.");
    // Rules G07-20 and G07-30: the city exists in the IBGE table and belongs to the state of the delivery.
    need(/^\d{7}$/.test(delivery.cityCode) && delivery.cityCode.slice(0, 2) === UF_CODES[delivery.uf], "Local de entrega: cidade da tabela do IBGE, no estado informado.");
    need(/^\d{8}$/.test(delivery.cep), "Local de entrega: CEP com oito dígitos.");
    need(delivery.street.trim() !== "" && delivery.number.trim() !== "" && delivery.district.trim() !== "" && delivery.city.trim() !== "", "Local de entrega: rua, número, bairro e cidade.");
  }

  need(rules.operationNature.trim() !== "", "Regras fiscais: natureza da operação.");
  for (const [name, cfop] of [["dentro do estado", rules.cfopInternal], ["para outro estado", rules.cfopInterstate], ["para não contribuinte de outro estado", rules.cfopInterstateNonTaxpayer]] as const) {
    need(/^[56]\d{3}$/.test(cfop), `Regras fiscais: CFOP de venda ${name}.`);
  }
  const simples = issuer.taxRegime === 1;
  need(simples ? ["102", "103", "300", "400"].includes(rules.icmsCode) : ["00", "40", "41", "50"].includes(rules.icmsCode),
    simples ? "Regras fiscais: CSOSN aceito hoje é 102, 103, 300 ou 400." : "Regras fiscais: CST do ICMS aceito hoje é 00, 40, 41 ou 50.");
  // Rule E16a-40 (rejection 696): a sale to who does not pay ICMS is a sale to a final consumer.
  need(recipient.taxpayer || rules.finalConsumer, "Regras fiscais: venda a não contribuinte do ICMS tem de ser a consumidor final. Marque a linha como venda a consumidor final ou informe a inscrição estadual do cliente.");
  // Rule N12-70 (rejection 508): with a non taxpayer the CST is 00, 20, 40, 41 or 60; suspension (50) is not a sale to them.
  need(simples || recipient.taxpayer || rules.icmsCode !== "50", "Regras fiscais: o CST 50 (suspensão) do ICMS não vale em venda a não contribuinte. Use 00, 40 ou 41.");
  const contributionCsts = [...CONTRIBUTION_RATE_CSTS, ...CONTRIBUTION_UNTAXED_CSTS, ...CONTRIBUTION_OTHER_CSTS];
  need(contributionCsts.includes(rules.pisCst) && contributionCsts.includes(rules.cofinsCst), "Regras fiscais: CST do PIS e da COFINS aceito hoje é 01, 02, 04 a 09 ou da tabela de 49 a 99 (o 03, por quantidade, não é emitido por aqui).");
  need(rules.ipiCst === null || IPI_TAXED_CSTS.includes(rules.ipiCst) || IPI_UNTAXED_CSTS.includes(rules.ipiCst), "Regras fiscais: CST do IPI da tabela (00 a 05, 49 a 55 ou 99), ou em branco para nota sem IPI.");
  need(rules.ipiCst !== null || input.items.every((item) => item.ipiRate === 0), "Regras fiscais: a linha tem IPI na tabela, falta o CST do IPI.");
  // An untaxed CST writes no IPI in the item while the price of the order carries it: the total would not match the items.
  need(rules.ipiCst === null || IPI_TAXED_CSTS.includes(rules.ipiCst) || input.items.every((item) => item.ipiRate === 0), "Regras fiscais: a linha tem IPI na tabela e o CST do IPI é de saída sem imposto. Use um CST tributado (50 ou 99) ou zere o IPI da linha.");

  need(rules.ibsCbs !== null || issuer.taxRegime !== 3, "Regras fiscais: CST e classificação tributária do IBS/CBS (obrigatórios para o regime normal desde 03/08/2026).");
  need(rules.ibsCbs === null || (/^\d{3}$/.test(rules.ibsCbs.cst) && /^\d{6}$/.test(rules.ibsCbs.classCode)), "Regras fiscais: CST do IBS/CBS com três dígitos e classificação tributária com seis.");

  need(FREIGHT_MODES.some(([code]) => code === input.freightMode), "Pedido: escolha a modalidade do frete da nota.");
  const carrier = input.transport.carrier;
  // Rule X07-10 of the layout: a carrier with a state registration has to say its state.
  need(!carrier || carrier.stateRegistration === null || Boolean(carrier.uf), "Transportadora: com inscrição estadual, informe a UF (Parâmetros → Transportadoras).");
  need(!carrier || (carrier.kind === "PJ" ? CNPJ_PATTERN : /^\d{11}$/).test(carrier.document), "Transportadora: CNPJ ou CPF completo (Parâmetros → Transportadoras).");
  need(input.items.length > 0, "Pedido sem itens.");
  // Rule NA01-20: with the group of the DIFAL, the rates are the ones the layout checks (NA09-10 to NA09-30 and the schema: 4%, 7% or 12%).
  const interstateTaxed = issuer.taxRegime !== 1 && rules.icmsCode === "00" && Boolean(UF_CODES[issuer.uf]) && issuer.uf !== destinationUf(input);
  const difal = interstateTaxed && !recipient.taxpayer && rules.finalConsumer;
  need(!difal || input.destination.internalIcms > 0, `Parâmetros: falta a alíquota interna do ICMS de ${destinationUf(input)}, para o DIFAL da venda a não contribuinte.`);
  input.items.forEach((item, index) => {
    const which = `Item ${index + 1} (${item.name})`;
    if (interstateTaxed && Number.isInteger(item.origin) && item.origin >= 0 && item.origin <= 8) {
      const expected = interstateRate(item.origin, issuer.uf, destinationUf(input));
      need(Math.abs(input.icmsRate - expected) < 1e-9, `${which}: a origem ${item.origin} pede ICMS interestadual de ${(expected * 100).toFixed(0)}% de ${issuer.uf} para ${destinationUf(input)}, e os parâmetros do pedido trazem ${(input.icmsRate * 100).toFixed(2).replace(".", ",")}%. Corrija a origem do equipamento ou o ICMS de saída do estado.`);
    }
    need(/^\d{8}$/.test(item.ncm), `${which}: NCM com oito dígitos (tela do equipamento).`);
    need(Number.isInteger(item.origin) && item.origin >= 0 && item.origin <= 8, `${which}: origem da mercadoria (tela do equipamento).`);
    need(item.quantity > 0 && item.unitPrice > 0, `${which}: quantidade e preço maiores que zero.`);
  });

  const total = nfeTotals(input).invoice;
  const paid = roundCents(input.payments.reduce((sum, payment) => sum + payment.amount, 0));
  const withoutPayment = input.payments.length === 1 && input.payments[0].code === "90";
  need(input.payments.length > 0 && (withoutPayment ? paid === 0 : paid === total), `Pagamento: as formas somam ${money(paid)} e a nota ${money(total)}.`);
  need(!input.payments.some((payment) => payment.code === "90") || withoutPayment, "Sem pagamento não pode ser combinado com outras formas.");
  need(input.payments.every((payment) => /^\d{2}$/.test(payment.code)), "Pagamento: há forma de pagamento sem o código da nota (Parâmetros → Fiscal → Forma de pagamento na nota).");
  need(input.payments.every((payment) => payment.code !== "99" || Boolean(payment.description?.trim())), 'Pagamento: forma "outros" precisa de descrição.');
  return problems;
}

type ItemFigures = { product: number; contributionBase: number; ipi: number; icmsBase: number; icms: number; pis: number; cofins: number; difalBase: number; difal: number; fcp: number; reformBase: number; ibsState: number; ibsCity: number; cbs: number };

/** The account of one item. The ICMS base takes the IPI only in a sale to a final consumer, when the rules say so. */
function figuresOf(item: NfeItem, input: NfeInput): ItemFigures {
  const { rules, issuer, recipient } = input;
  const product = roundCents(item.quantity * item.unitPrice);
    // Keep the IPI agreed in the order visible while its CST is still missing.
    // nfeProblems blocks XML generation until that classification is supplied.
    const ipi = roundCents(product * item.ipiRate);
  const taxed = issuer.taxRegime !== 1 && rules.icmsCode === "00";
  const icmsBase = taxed ? roundCents(product + (rules.finalConsumer && rules.ipiInIcmsBase ? ipi : 0)) : 0;
  const interstate = issuer.uf !== destinationUf(input);
  const owesDifal = taxed && interstate && !recipient.taxpayer && rules.finalConsumer;
  const icms = roundCents(icmsBase * input.icmsRate);
  // A CST without figures (04 to 09) writes no value in the item: counting one would leave the total different from the sum of the items (rules W13-10 and W14-10).
  // Only the ICMS of the operation itself leaves the base; the DIFAL belongs to the state of destination and stays out of this account.
  const contributionBase = rules.icmsOutOfContributions ? roundCents(product - icms) : product;
  const pis = CONTRIBUTION_UNTAXED_CSTS.includes(rules.pisCst) ? 0 : roundCents(contributionBase * rules.pisRate);
  const cofins = CONTRIBUTION_UNTAXED_CSTS.includes(rules.cofinsCst) ? 0 : roundCents(contributionBase * rules.cofinsRate);
  const difal = owesDifal ? roundCents(icmsBase * Math.max(0, input.destination.internalIcms - input.icmsRate)) : 0;
  const fcp = owesDifal ? roundCents(icmsBase * input.destination.fcp) : 0;
  // Base of IBS and CBS (rule UB16-10): the product less the taxes it carries inside.
  const reformBase = rules.ibsCbs ? roundCents(product - pis - cofins - icms - difal - fcp) : 0;
  return {
    product,
    contributionBase,
    ipi,
    icmsBase,
    icms,
    pis,
    cofins,
    difalBase: owesDifal ? icmsBase : 0,
    difal,
    fcp,
    reformBase,
    ibsState: rules.ibsCbs ? roundCents(reformBase * rules.ibsCbs.ibsStateRate) : 0,
    ibsCity: rules.ibsCbs ? roundCents(reformBase * rules.ibsCbs.ibsCityRate) : 0,
    cbs: rules.ibsCbs ? roundCents(reformBase * rules.ibsCbs.cbsRate) : 0,
  };
}

export type NfeTotals = { products: number; ipi: number; icmsBase: number; icms: number; pis: number; cofins: number; difal: number; fcp: number; invoice: number; reformBase: number; ibsState: number; ibsCity: number; cbs: number };

/** The totals of the invoice: the sum of the items, each already in cents. The invoice total is products plus IPI. */
export function nfeTotals(input: NfeInput): NfeTotals {
  const sum = (pick: (figures: ItemFigures) => number) => roundCents(input.items.reduce((total, item) => total + pick(figuresOf(item, input)), 0));
  const products = sum((figures) => figures.product);
  const ipi = sum((figures) => figures.ipi);
  return {
    products,
    ipi,
    icmsBase: sum((figures) => figures.icmsBase),
    icms: sum((figures) => figures.icms),
    pis: sum((figures) => figures.pis),
    cofins: sum((figures) => figures.cofins),
    difal: sum((figures) => figures.difal),
    fcp: sum((figures) => figures.fcp),
    // In 2026 IBS and CBS are informed and do not add to the total of the invoice.
    invoice: roundCents(products + ipi),
    reformBase: sum((figures) => figures.reformBase),
    ibsState: sum((figures) => figures.ibsState),
    ibsCity: sum((figures) => figures.ibsCity),
    cbs: sum((figures) => figures.cbs),
  };
}

/** PIS or COFINS of one item: the group depends on the CST. */
function contribution(name: "PIS" | "COFINS", cst: string, base: number, fraction: number, value: number): string {
  const p = name === "PIS" ? "pPIS" : "pCOFINS";
  const v = name === "PIS" ? "vPIS" : "vCOFINS";
  const figures = tag("vBC", money(base)) + tag(p, rate(fraction)) + tag(v, money(value));
  if (CONTRIBUTION_RATE_CSTS.includes(cst)) return group(name, group(`${name}Aliq`, tag("CST", cst) + figures));
  if (CONTRIBUTION_UNTAXED_CSTS.includes(cst)) return group(name, group(`${name}NT`, tag("CST", cst)));
  return group(name, group(`${name}Outr`, tag("CST", cst) + figures));
}

function itemXml(item: NfeItem, index: number, input: NfeInput): string {
  const { rules, issuer, recipient } = input;
  const figures = figuresOf(item, input);
  const interstate = issuer.uf !== destinationUf(input);
  const cfop = !interstate ? rules.cfopInternal : recipient.taxpayer ? rules.cfopInterstate : rules.cfopInterstateNonTaxpayer;
  const quantity = item.quantity.toFixed(4);
  const unit = item.unitPrice.toFixed(10);

  const product = group(
    "prod",
    tag("cProd", clean(item.code, 60)) +
      tag("cEAN", "SEM GTIN") +
      tag("xProd", input.environment === "homologacao" && index === 0 ? HOMOLOGATION_NAME : clean(item.name, 120)) +
      tag("NCM", item.ncm) +
      tag("CEST", item.cest) +
      tag("CFOP", cfop) +
      tag("uCom", item.unit) +
      tag("qCom", quantity) +
      tag("vUnCom", unit) +
      tag("vProd", money(figures.product)) +
      tag("cEANTrib", "SEM GTIN") +
      tag("uTrib", item.unit) +
      tag("qTrib", quantity) +
      tag("vUnTrib", unit) +
      tag("indTot", "1"),
  );

  const origin = tag("orig", String(item.origin));
  const icms =
    issuer.taxRegime === 1
      ? group("ICMSSN102", origin + tag("CSOSN", rules.icmsCode))
      : rules.icmsCode === "00"
        ? group("ICMS00", origin + tag("CST", "00") + tag("modBC", "3") + tag("vBC", money(figures.icmsBase)) + tag("pICMS", rate(input.icmsRate)) + tag("vICMS", money(figures.icms)))
        : group("ICMS40", origin + tag("CST", rules.icmsCode));

  const ipi =
    rules.ipiCst === null
      ? ""
      : group(
          "IPI",
          tag("cEnq", rules.ipiFrameCode) +
            (IPI_TAXED_CSTS.includes(rules.ipiCst)
              ? group("IPITrib", tag("CST", rules.ipiCst) + tag("vBC", money(figures.product)) + tag("pIPI", rate(item.ipiRate)) + tag("vIPI", money(figures.ipi)))
              : group("IPINT", tag("CST", rules.ipiCst))),
        );

  const difal =
    figures.difalBase === 0
      ? ""
      : group(
          "ICMSUFDest",
          tag("vBCUFDest", money(figures.difalBase)) +
            tag("vBCFCPUFDest", money(figures.difalBase)) +
            tag("pFCPUFDest", rate(input.destination.fcp)) +
            tag("pICMSUFDest", rate(input.destination.internalIcms)) +
            tag("pICMSInter", (input.icmsRate * 100).toFixed(2)) +
            tag("pICMSInterPart", "100.0000") +
            tag("vFCPUFDest", money(figures.fcp)) +
            tag("vICMSUFDest", money(figures.difal)) +
            tag("vICMSUFRemet", "0.00"),
        );

  const taxes = group(
    "imposto",
    group("ICMS", icms) +
      ipi +
      contribution("PIS", rules.pisCst, figures.contributionBase, rules.pisRate, figures.pis) +
      contribution("COFINS", rules.cofinsCst, figures.contributionBase, rules.cofinsRate, figures.cofins) +
      difal +
      (rules.ibsCbs
        ? group(
            "IBSCBS",
            tag("CST", rules.ibsCbs.cst) +
              tag("cClassTrib", rules.ibsCbs.classCode) +
              group(
                "gIBSCBS",
                tag("vBC", money(figures.reformBase)) +
                  group("gIBSUF", tag("pIBSUF", rate(rules.ibsCbs.ibsStateRate)) + tag("vIBSUF", money(figures.ibsState))) +
                  group("gIBSMun", tag("pIBSMun", rate(rules.ibsCbs.ibsCityRate)) + tag("vIBSMun", money(figures.ibsCity))) +
                  tag("vIBS", money(figures.ibsState + figures.ibsCity)) +
                  group("gCBS", tag("pCBS", rate(rules.ibsCbs.cbsRate)) + tag("vCBS", money(figures.cbs))),
              ),
          )
        : ""),
  );
  return group("det", product + taxes, ` nItem="${index + 1}"`);
}

/** The transport group: the way of freight always; the carrier and the volumes only with what was informed. */
function transportXml(input: NfeInput): string {
  const { carrier, volumes, volumeKind, netWeight, grossWeight } = input.transport;
  const weight = (value: number | null) => (value === null ? null : value.toFixed(3));
  return group(
    "transp",
    tag("modFrete", input.freightMode) +
      (carrier
        ? group(
            "transporta",
            tag(carrier.kind === "PJ" ? "CNPJ" : "CPF", carrier.document) +
              tag("xNome", clean(carrier.name, 60)) +
              tag("IE", carrier.stateRegistration) +
              tag("xEnder", carrier.address ? clean(carrier.address, 60) : null) +
              tag("xMun", carrier.city ? clean(carrier.city, 60) : null) +
              tag("UF", carrier.uf),
          )
        : "") +
      group("vol", tag("qVol", volumes) + tag("esp", volumeKind ? clean(volumeKind, 60) : null) + tag("pesoL", weight(netWeight)) + tag("pesoB", weight(grossWeight))),
  );
}

/**
 * The XML of the invoice, not signed. Throws `NfeError` with everything that is
 * missing: an invoice with a hole never leaves here.
 */
export function buildNfeXml(input: NfeInput): { key: string; xml: string; totals: NfeTotals } {
  const problems = nfeProblems(input);
  if (problems.length > 0) throw new NfeError(problems.join("\n"));

  const { issuer, recipient, rules } = input;
  const key = accessKey(input);
  const totals = nfeTotals(input);
  const interstate = issuer.uf !== destinationUf(input);
  const homologation = input.environment === "homologacao";

  const ide = group(
    "ide",
    tag("cUF", UF_CODES[issuer.uf]) +
      tag("cNF", input.randomCode) +
      tag("natOp", clean(rules.operationNature, 60)) +
      tag("mod", "55") +
      tag("serie", input.series) +
      tag("nNF", input.number) +
      tag("dhEmi", input.issuedAt) +
      tag("tpNF", "1") +
      tag("idDest", interstate ? "2" : "1") +
      tag("cMunFG", issuer.cityCode) +
      tag("tpImp", "1") +
      tag("tpEmis", "1") +
      tag("cDV", key[43]) +
      tag("tpAmb", homologation ? "2" : "1") +
      tag("finNFe", "1") +
      tag("indFinal", rules.finalConsumer ? "1" : "0") +
      tag("indPres", "9") +
      tag("indIntermed", "0") +
      tag("procEmi", "0") +
      tag("verProc", clean(input.software, 20)),
  );

  const emit = group(
    "emit",
    tag("CNPJ", issuer.cnpj) + tag("xNome", clean(issuer.legalName, 60)) + address("enderEmit", issuer) + tag("IE", issuer.stateRegistration) + tag("CRT", issuer.taxRegime),
  );

  const dest = group(
    "dest",
    tag(recipient.kind === "PJ" ? "CNPJ" : "CPF", recipient.document) +
      tag("xNome", homologation ? HOMOLOGATION_NAME : clean(recipient.name, 60)) +
      address("enderDest", recipient) +
      tag("indIEDest", recipient.taxpayer ? "1" : "9") +
      tag("IE", recipient.taxpayer ? recipient.stateRegistration : null) +
      // An address cut at 60 letters is another address: one that does not fit is left out (the field is optional).
      tag("email", recipient.email && clean(recipient.email, 61).length <= 60 ? clean(recipient.email, 60) : null),
  );

  const place = input.delivery;
  const entrega = place
    ? group(
        "entrega",
        tag(place.kind === "PJ" ? "CNPJ" : "CPF", place.document) +
          tag("xNome", place.name ? clean(place.name, 60) : null) +
          tag("xLgr", clean(place.street, 60)) +
          tag("nro", clean(place.number, 60)) +
          tag("xCpl", place.complement ? clean(place.complement, 60) : null) +
          tag("xBairro", clean(place.district, 60)) +
          tag("cMun", place.cityCode) +
          tag("xMun", clean(place.city, 60)) +
          tag("UF", place.uf) +
          tag("CEP", place.cep) +
          tag("cPais", "1058") +
          tag("xPais", "BRASIL") +
          tag("fone", place.phone ? onlyDigits(place.phone).slice(0, 14) : null),
      )
    : "";

  const hasDifal = totals.difal > 0 || totals.fcp > 0;
  const total = group(
    "total",
    group(
      "ICMSTot",
      tag("vBC", money(totals.icmsBase)) +
        tag("vICMS", money(totals.icms)) +
        tag("vICMSDeson", "0.00") +
        (hasDifal ? tag("vFCPUFDest", money(totals.fcp)) + tag("vICMSUFDest", money(totals.difal)) + tag("vICMSUFRemet", "0.00") : "") +
        tag("vFCP", "0.00") +
        tag("vBCST", "0.00") +
        tag("vST", "0.00") +
        tag("vFCPST", "0.00") +
        tag("vFCPSTRet", "0.00") +
        tag("vProd", money(totals.products)) +
        tag("vFrete", "0.00") +
        tag("vSeg", "0.00") +
        tag("vDesc", "0.00") +
        tag("vII", "0.00") +
        tag("vIPI", money(totals.ipi)) +
        tag("vIPIDevol", "0.00") +
        tag("vPIS", money(totals.pis)) +
        tag("vCOFINS", money(totals.cofins)) +
        tag("vOutro", "0.00") +
        tag("vNF", money(totals.invoice)),
    ) +
      (rules.ibsCbs
        ? group(
            "IBSCBSTot",
            tag("vBCIBSCBS", money(totals.reformBase)) +
              group(
                "gIBS",
                group("gIBSUF", tag("vDif", "0.00") + tag("vDevTrib", "0.00") + tag("vIBSUF", money(totals.ibsState))) +
                  group("gIBSMun", tag("vDif", "0.00") + tag("vDevTrib", "0.00") + tag("vIBSMun", money(totals.ibsCity))) +
                  tag("vIBS", money(totals.ibsState + totals.ibsCity)) +
                  tag("vCredPres", "0.00") +
                  tag("vCredPresCondSus", "0.00"),
              ) +
              group("gCBS", tag("vDif", "0.00") + tag("vDevTrib", "0.00") + tag("vCBS", money(totals.cbs)) + tag("vCredPres", "0.00") + tag("vCredPresCondSus", "0.00")),
          )
        : ""),
  );

  const payment = group(
    "pag",
    input.payments
      .map((item) => group(
        "detPag",
        tag("tPag", item.code) +
          tag("xPag", item.code === "99" ? clean(item.description ?? "", 60) : null) +
          tag("vPag", money(item.amount)) +
          (NON_INTEGRATED_ELECTRONIC_PAYMENTS.has(item.code) ? group("card", tag("tpIntegra", "2")) : ""),
      ))
      .join(""),
  );

  const body =
    ide +
    emit +
    dest +
    entrega +
    input.items.map((item, index) => itemXml(item, index, input)).join("") +
    total +
    transportXml(input) +
    payment +
    group("infAdic", tag("infCpl", rules.additionalInfo ? clean(rules.additionalInfo, 5000) : null));

  const xml = `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="${NAMESPACE}"><infNFe versao="4.00" Id="NFe${key}">${body}</infNFe></NFe>`;
  return { key, xml, totals };
}
