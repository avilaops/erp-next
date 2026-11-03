/** Numeric identifiers only. Each fiscal schema independently defines whether letters are allowed. */
export function isNumericCnpj(value: string): boolean {
  if (typeof value !== "string" || !/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  for (const length of [12, 13]) {
    let weight = length - 7, total = 0;
    for (let index = 0; index < length; index++) {
      total += Number(value[index]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const remainder = total % 11;
    if (Number(value[length]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}

export function isNumericCpf(value: string): boolean {
  if (typeof value !== "string" || !/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  for (const length of [9, 10]) {
    let total = 0;
    for (let index = 0; index < length; index++) total += Number(value[index]) * (length + 1 - index);
    const digit = total * 10 % 11;
    if (Number(value[length]) !== (digit === 10 ? 0 : digit)) return false;
  }
  return true;
}
