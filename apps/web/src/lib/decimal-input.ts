/** Decimal text only: no grouping, exponents, floating-point conversion or rounding. */
export function decimalPattern(places: number) {
  return "(0|[1-9][0-9]{0,11})([.,][0-9]{1," + places + "})?"
}

export function normalizeDecimal(raw: string, places = 2): string | null {
  const value = raw.trim()
  if (!new RegExp("^" + decimalPattern(places) + "$").test(value)) return null
  const [whole, fraction = ""] = value.replace(",", ".").split(".")
  return whole + "." + fraction.padEnd(places, "0")
}
