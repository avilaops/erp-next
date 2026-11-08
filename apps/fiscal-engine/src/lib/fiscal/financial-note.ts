import type { NfeInput } from "./nfe.ts";

export const CREDIT_TYPES = ["01", "02", "03", "04", "05", "06"] as const;
export const DEBIT_TYPES = ["01", "02", "03", "04", "05", "06", "07", "08"] as const;
export function financialLegacyMode(input: Pick<NfeInput, "purpose" | "creditType" | "debitType" | "issuedAt">): "all" | "none" | "ipi" | "contributions-ipi" {
  if (input.purpose !== 5 && input.purpose !== 6 || input.purpose === 5 && ["03", "04", "06"].includes(input.creditType ?? "")) return "all";
  if (input.purpose === 6 && input.debitType === "06") return input.issuedAt.slice(0, 4) === "2026" ? "contributions-ipi" : "ipi";
  return "none";
}
function validReference(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  let sum = 0; for (let i = 42; i >= 0; i--) sum += Number(key[i]) * (2 + (42 - i) % 8);
  const remainder = sum % 11;
  return key[43] === String(remainder < 2 ? 0 : 11 - remainder) && ["55", "65"].includes(key.slice(20, 22));
}
/** NT 2025.002 v1.53: explicit fiscal subtype and reference rules, before XML signing. */
export function financialNoteProblems(input: NfeInput): string[] {
  const errors: string[] = [], purpose = input.purpose ?? 1, credit = input.creditType, debit = input.debitType;
  const need = (ok: boolean, message: string) => { if (!ok) errors.push(message); };
  const items = input.items, refs = input.referencedAccessKeys ?? [], itemRefs = items.flatMap(item => item.referencedDfe ? [item.referencedDfe] : []);
  need(purpose === 5 ? CREDIT_TYPES.includes(credit as typeof CREDIT_TYPES[number]) && debit == null : credit == null, "Tipo de crédito exige finalidade 5 e código 01 a 06, sem tipo de débito.");
  need(purpose === 6 ? DEBIT_TYPES.includes(debit as typeof DEBIT_TYPES[number]) && credit == null : debit == null, "Tipo de débito exige finalidade 6 e código 01 a 08, sem tipo de crédito.");
  if (purpose !== 5 && purpose !== 6) {
    need(itemRefs.length === 0, "Referência DF-e por item está habilitada somente nas notas de crédito e débito.");
    return errors;
  }
  need(input.model !== 65 && input.issuer.taxRegime === 3 && input.recipient.uf !== "EX" && !input.exportation && !input.returnDirection, "Notas de crédito e débito exigem NF-e doméstica CRT 3, sem modalidade de exportação ou devolução.");
  if (purpose === 5) {
    need(["01", "03", "04", "06"].includes(credit ?? ""), credit === "02" ? "Crédito 02 exige grupo de crédito presumido ZFM e emissão a partir de 2029; grupo ainda não suportado." : "Crédito 05 exige grupo de transferência de crédito ainda não suportado.");
    if (["01", "03", "04"].includes(credit ?? "")) need(refs.length === 1, "Crédito 01, 03 e 04 exige exatamente uma NF-e referenciada no cabeçalho.");
    if (credit !== "06") need(itemRefs.length === 0, "Somente crédito 06 permite referência DF-e por item.");
    if (["03", "04"].includes(credit ?? "")) need(refs.every(key => key.slice(0, 2) === input.issuer.cityCode.slice(0, 2) && key.slice(6, 20) === input.issuer.cnpj), "Crédito 03 e 04 exige referência da mesma UF e do mesmo emitente.");
    need(refs.every(key => validReference(key) && (key.slice(20, 22) === "55" || credit === "03")), "Crédito exige chave NF-e modelo 55 válida; crédito 03 também permite NFC-e modelo 65.");
  } else {
    need(["03", "04", "06"].includes(debit ?? ""), "Subtipo de débito exige grupo de transferência, estorno ou ajuste de competência ainda não suportado.");
  }
  const perItemRequired = purpose === 5 && credit === "06" || purpose === 6 && ["03", "04"].includes(debit ?? "");
  need(!perItemRequired || itemRefs.length === items.length, "Este subtipo exige referência DF-e em cada item.");
  need(!(itemRefs.length && refs.length), "Não combine referência no cabeçalho com referência DF-e por item.");
  need(refs.length <= 99 && refs.every(validReference) && new Set(refs).size === refs.length, "Chaves referenciadas inválidas ou repetidas.");
  const references = new Set<string>();
  for (const ref of itemRefs) {
    need(validReference(ref.accessKey) && ref.accessKey.slice(20, 22) === "55", "Referência por item exige chave NF-e modelo 55 válida.");
    need(debit === "03" ? ref.itemNumber == null : Number.isInteger(ref.itemNumber) && ref.itemNumber! >= 1 && ref.itemNumber! <= 990, "Débito 03 proíbe número do item de origem; outros subtipos exigem item 1 a 990.");
    const binding = `${ref.accessKey}:${ref.itemNumber ?? ""}`; need(!references.has(binding), "DF-e e item de origem não podem se repetir."); references.add(binding);
  }
  need(debit === "03" || new Set(itemRefs.map(ref => ref.accessKey)).size <= 1, "Este subtipo permite somente um documento fiscal de origem.");
  need(debit !== "06" || input.rules.ipiCst == null && items.every(item => item.ipiRate === 0), "IPI em pagamento antecipado exige leiaute que permita IPI sem ICMS/ISSQN; não suportado pelo pacote PL_010g v1.03 fixado.");
  const mode = financialLegacyMode(input);
  need(mode === "all" || input.icmsRate === 0 && ["40", "41"].includes(input.rules.icmsCode), "Este subtipo não permite ICMS: declare CST 40/41 sem alíquota.");
  need(mode !== "none" || input.rules.ipiCst == null && items.every(item => item.ipiRate === 0), "Este subtipo não permite IPI.");
  need(mode !== "none" && mode !== "ipi" || input.rules.pisRate === 0 && input.rules.cofinsRate === 0 && ["04", "05", "06", "07", "08", "09"].includes(input.rules.pisCst) && ["04", "05", "06", "07", "08", "09"].includes(input.rules.cofinsCst), "Este subtipo/ano não permite PIS ou COFINS.");
  return errors;
}
