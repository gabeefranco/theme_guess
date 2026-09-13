import { similarityFromHex } from '../engine/colorUtils';
import { CATEGORY_META } from '../data/themes';
import type { CategoryStateMap, MatchResult } from '../types';

// Power-mean exponent used to combine per-category similarities into one
// overall score. 1 would be a plain weighted average — it only cares
// about total similarity, so a guess that nails a few high-weight
// categories and whiffs the rest scores the same as one that lands
// respectably close on everything. Any exponent below 1 makes the mean
// concave in each `sim`, so — by the power-mean inequality — two guesses
// with the *same* weighted-average similarity are no longer scored
// equally: the more evenly that similarity is spread across categories,
// the higher the result, and spikier profiles (some near-perfect, others
// badly missed) score strictly lower. 0.6 was picked empirically: harsh
// enough to reward consistency, but nowhere near the geometric-mean limit
// (exponent -> 0), which would crash the whole score to ~0 whenever a
// single category was left unassigned (sim 0) — a real case, since a
// round can be revealed before every category is filled.
const EVENNESS_EXPONENT = 0.6;

/** Weighted power-mean (see `EVENNESS_EXPONENT`) of how close each
 * guessed color landed to the theme's real color, in perceptual
 * (CIELAB) distance. */
export function computeMatchResult(categories: CategoryStateMap): MatchResult {
  let totalWeight = 0;
  let weightedPowerSum = 0;
  const rows: MatchResult['rows'] = [];

  for (const def of CATEGORY_META) {
    const cat = categories[def.id];
    const sim = similarityFromHex(cat.assignedHex, cat.actualHex);
    totalWeight += cat.weight;
    weightedPowerSum += cat.weight * Math.pow(sim, EVENNESS_EXPONENT);
    rows.push({ ...def, guess: cat.assignedHex, actualHex: cat.actualHex, sim });
  }

  const overall = Math.pow(weightedPowerSum / totalWeight, 1 / EVENNESS_EXPONENT);
  return { overall: Math.round(overall), rows };
}
