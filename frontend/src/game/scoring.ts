import { similarityFromHex } from '../engine/colorUtils';
import { CATEGORY_META } from '../data/themes';
import type { CategoryStateMap, MatchResult } from '../types';

/** Weighted-by-frequency average of how close each guessed color landed
 * to the theme's real color, in perceptual (CIELAB) distance. */
export function computeMatchResult(categories: CategoryStateMap): MatchResult {
  let totalWeight = 0;
  let weightedSum = 0;
  const rows: MatchResult['rows'] = [];

  for (const def of CATEGORY_META) {
    const cat = categories[def.id];
    const sim = similarityFromHex(cat.assignedHex, cat.actualHex);
    totalWeight += cat.weight;
    weightedSum += sim * cat.weight;
    rows.push({ ...def, guess: cat.assignedHex, actualHex: cat.actualHex, sim });
  }

  return { overall: Math.round(weightedSum / totalWeight), rows };
}
