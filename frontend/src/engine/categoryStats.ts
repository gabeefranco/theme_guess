// Derives per-category token counts and scoring weights from a
// tokenized snippet — the shared "how much does each category matter"
// logic `ThemeGuessGame.build()`, `botMatch.ts`, and `multiplayerMatch.ts`
// each need to build a `CategoryStateMap` (directly, or via
// `game/scoring.ts`'s weighted average). Pure and DOM-free, so it lives
// here rather than being re-derived independently in each `game/` call
// site (as it used to be — three copies of the same formula, one typo
// away from silently diverging).

import { CATEGORY_META } from '../data/themes';
import type { CategoryId, Token } from '../types';

export interface CategoryStats {
  /** How many times each category's token kind appears in the snippet
   * (always 0 for 'background', which isn't a token). Drives the panel
   * card's "N tokens" label. */
  counts: Record<CategoryId, number>;
  /** Scoring weight per category — see `computeCategoryStats`'s doc for
   * the reasoning. Consumed by `game/scoring.ts`'s weighted average. */
  weights: Record<CategoryId, number>;
}

/** Foreground categories are weighted by their own token frequency —
 * a color the player sees 30 times in the snippet should count more
 * toward the final score than one they saw only once — floored at 3 so
 * a rare kind (often just a single comment) still counts for something.
 *
 * `background` isn't a token and has no frequency of its own. Weighting
 * it by the single *most* frequent category's count (as this used to)
 * let one snippet-dependent spike — punctuation or operators easily top
 * 70-100 occurrences — dwarf every other category combined, so the
 * overall score ended up mostly measuring "did you get punctuation and
 * the background close" and barely anything else. Weighting it as one
 * *typical* category instead — the mean of the other eleven — keeps it
 * meaningfully important (it's the single largest area of the screen)
 * without letting it, or its formerly-conflated counterpart, swamp
 * every other guess. */
export function computeCategoryStats(tokens: Token[]): CategoryStats {
  const counts = {} as Record<CategoryId, number>;
  for (const def of CATEGORY_META) counts[def.id] = 0;
  for (const t of tokens) {
    if (t.type === 'whitespace' || t.type === 'newline' || t.type === 'identifier') continue;
    const id = t.type as CategoryId;
    counts[id] += 1;
  }

  const weights = {} as Record<CategoryId, number>;
  let otherSum = 0;
  let otherN = 0;
  for (const def of CATEGORY_META) {
    if (def.id === 'background') continue;
    const w = Math.max(counts[def.id], 3);
    weights[def.id] = w;
    otherSum += w;
    otherN += 1;
  }
  weights.background = Math.round(otherSum / otherN);

  return { counts, weights };
}
