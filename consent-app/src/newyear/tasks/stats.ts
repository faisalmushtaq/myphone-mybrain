/** Small statistics helpers for scoring the brain checks. */

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The inverse of the standard normal distribution (the z-score for a
 * probability), by Acklam's rational approximation: relative error below
 * 1.2e-9 across the whole range, which is far more precise than needed.
 */
export function inverseNormalCdf(p: number): number {
  if (Number.isNaN(p)) return Number.NaN;
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Sensitivity d′ = z(hit rate) − z(false-alarm rate), with the log-linear
 * correction (Hautus, 1995) applied to every count: 0.5 is added to the hits
 * and false alarms and 1 to the number of targets and standards. This keeps
 * d′ finite when someone catches every target or never taps by mistake, and
 * biases it less than replacing only the extreme rates. Null when there were
 * no targets or no standards to score.
 */
export function dPrime(hits: number, targets: number, falseAlarms: number, standards: number): number | null {
  if (targets <= 0 || standards <= 0) return null;
  const hitRate = (hits + 0.5) / (targets + 1);
  const faRate = (falseAlarms + 0.5) / (standards + 1);
  return inverseNormalCdf(hitRate) - inverseNormalCdf(faRate);
}
