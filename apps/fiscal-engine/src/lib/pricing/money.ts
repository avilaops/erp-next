/**
 * Money is a plain number in reais. Every calculation keeps full precision and
 * only what leaves the engine is rounded, with this function.
 */

/** Rounds to cents, half away from zero (1.005 becomes 1.01, as on paper). */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Valor em reais inválido.");
  // toPrecision removes the binary noise (1.005 * 100 = 100.49999999999999).
  const cents = Math.round(Number((Math.abs(value) * 100).toPrecision(15)));
  return (Math.sign(value) * cents) / 100 || 0;
}

/** Slack for comparing rates that come out of a division. */
export const RATE_EPSILON = 1e-9;

/**
 * Slack for placing a discount in a band: one hundredth of a percentage point.
 * Table prices are rounded to cents, so the limit a table was built for (20%)
 * comes out as 19.99999% and must still count as inside the band.
 */
export const BAND_SLACK = 1e-4;

/** Throws unless `value` is an amount in reais: a finite number, zero or more. */
export function assertAmount(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} precisa ser um valor em reais, zero ou mais.`);
  }
}

/** Throws unless `value` is a rate in [0, 1). */
export function assertRate(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${label} precisa ser uma taxa de 0% até menos de 100%.`);
  }
}
