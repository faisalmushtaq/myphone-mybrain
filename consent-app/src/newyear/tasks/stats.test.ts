import { describe, expect, it } from 'vitest';
import { dPrime, inverseNormalCdf, mean, median } from './stats';

/** An independent standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7), to check the inverse against. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

describe('statistics for the scores', () => {
  it('finds the mean and median', () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('inverts the normal distribution accurately', () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 12);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
    expect(inverseNormalCdf(0.025)).toBeCloseTo(-1.959964, 5);
    expect(inverseNormalCdf(0.8413447460685429)).toBeCloseTo(1, 6);
    expect(inverseNormalCdf(0.001)).toBeCloseTo(-3.090232, 5);
    // The reference CDF is good to about 1e-7, which limits the round trip in the tails to about 1e-4.
    for (let x = -3.5; x <= 3.5; x += 0.25) expect(inverseNormalCdf(normalCdf(x))).toBeCloseTo(x, 3);
    for (let x = -1.5; x <= 1.5; x += 0.25) expect(inverseNormalCdf(normalCdf(x))).toBeCloseTo(x, 5);
    expect(inverseNormalCdf(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(inverseNormalCdf(1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('computes d′ with the log-linear correction, so rates of 0 and 1 stay finite', () => {
    // Symmetric: the corrected hit rate is one minus the corrected false-alarm rate.
    expect(dPrime(20, 20, 0, 20)).toBeCloseTo(2 * inverseNormalCdf(20.5 / 21), 10);
    expect(dPrime(10, 20, 40, 80)).toBeCloseTo(inverseNormalCdf(10.5 / 21) - inverseNormalCdf(40.5 / 81), 10);
    expect(dPrime(10, 20, 40, 80)).toBeCloseTo(0, 10);
    expect(dPrime(0, 20, 80, 80)).toBeLessThan(-4);
    expect(dPrime(1, 0, 0, 10)).toBeNull();
    expect(dPrime(1, 1, 0, 0)).toBeNull();
  });
});
