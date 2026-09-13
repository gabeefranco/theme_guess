// Solo-vs-bot opponent AI: decides *when* the bot assigns a color to each
// category and *how close* that color lands to the theme's real answer.
// Pure and DOM-free — the caller (opponent-view renderer) is responsible
// for turning the returned schedule into on-screen updates over time.

import type { CategoryId, RGB } from '../types';
import { hexToRgb, rgbToHex, lerpRgb, similarityFromHex } from './colorUtils';

export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type BotTimeMode = '2min' | '4min' | 'none';

export interface BotCategoryInput {
  id: CategoryId;
  /** The theme's real (target) color for this category. */
  hex: string;
}

export interface ComputeBotScheduleOptions {
  difficulty: BotDifficulty;
  timeMode: BotTimeMode;
  categories: BotCategoryInput[];
}

/** One category assignment the bot makes during the round. */
export interface BotPick {
  categoryId: CategoryId;
  /** Milliseconds after round start when the bot assigns this category. */
  atMs: number;
  hex: string;
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** 2-minute mode collapses to the 'short' band, 4-minute and no-limit both
 * get the more generous 'long' band (same target pace either way — a
 * countdown vs. no countdown doesn't change how "fast" the bot thinks). */
type TimeBand = 'short' | 'long';

interface TimeModeConfig {
  /** Target time (ms) for the bot's *last* pick, before jitter. */
  targetMs: number;
  /** Random variation applied to targetMs, uniformly in [-jitterMs, +jitterMs]. */
  jitterMs: number;
  /** Hard deadline (ms) the round ends at, or null when there isn't one. */
  deadlineMs: number | null;
}

// Margin kept between the (jittered) finish time and the real deadline, on
// top of the jitter range already being sized to stay under the cap. Belt
// and suspenders: guarantees `computeBotSchedule` can never schedule a pick
// at or after the deadline, regardless of how targetMs/jitterMs are tuned.
const DEADLINE_SAFETY_MARGIN_MS = 1_500;

const TIME_MODE_CONFIG: Record<BotTimeMode, TimeModeConfig> = {
  // ~1m50s target, ±8s jitter -> finishes 102-118s, safely under the 120s cap.
  '2min': { targetMs: 110_000, jitterMs: 8_000, deadlineMs: 120_000 },
  // ~3m30s target, ±10s jitter -> finishes 200-220s, safely under the 240s cap.
  '4min': { targetMs: 210_000, jitterMs: 10_000, deadlineMs: 240_000 },
  // Same ~3m30s target as 4-minute mode (no deadline to clamp against, but
  // no reason for the bot to pace itself any differently).
  none: { targetMs: 210_000, jitterMs: 10_000, deadlineMs: null },
};

/** Splits `totalMs` into `n` ascending pick times that sum to totalMs, with
 * randomized (not perfectly even) gaps so the pacing reads as "thinking"
 * rather than a metronome. Each gap is an independent random weight in
 * [0.6, 1.4] of the average gap, then normalized to fit the total. */
function distributeTimes(n: number, totalMs: number): number[] {
  const weights = Array.from({ length: n }, () => 0.6 + Math.random() * 0.8);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  return weights.map((w) => {
    acc += (w / weightSum) * totalMs;
    return Math.round(acc);
  });
}

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

// Absolute cap: outside the no-limit "documented exception" below, no pick
// on any difficulty, in any time mode, may reach or exceed this similarity
// (similarityFromHex's 0-100 scale, 100 = exact match). The bot never
// "solves" a category on its own.
const MAX_ACCURACY = 95;

/** Max similarity a pick may reach, per difficulty and time band. Below
 * MAX_ACCURACY everywhere. Ordering is intentional both ways: easy < medium
 * < hard within a band (harder bot aims truer), and short < long within a
 * difficulty (more thinking time -> more accurate). */
const ACCURACY_CEILING: Record<BotDifficulty, Record<TimeBand, number>> = {
  easy: { short: 62, long: 72 },
  medium: { short: 78, long: 88 },
  hard: { short: 88, long: 95 },
};

/** How far below its ceiling a pick may randomly land — the achieved
 * similarity is sampled uniformly from [ceiling - spread, ceiling]. A wide
 * spread reads as "inconsistent aim" (Easy), a narrow one as "reliably
 * close" (Hard). Medium sits between the two. */
const ACCURACY_SPREAD: Record<BotDifficulty, number> = {
  easy: 38,
  medium: 24,
  hard: 12,
};

// *** DOCUMENTED EXCEPTION to "never perfect" ***
// In no-limit mode only, each pick independently has this probability of
// being an exact/perfect match (100% similarity) for its category,
// regardless of difficulty. This deliberately contradicts MAX_ACCURACY
// above — justification: with no clock pressure the bot is modeled as
// eventually "getting lucky" on some categories, which also keeps no-limit
// games from feeling identical to 2-minute games. Kept a minority outcome
// (well under 50%) so most picks still fall under the normal ceiling.
const NO_LIMIT_PERFECT_CHANCE = 0.35;

/** Binary-searches how far to lerp `targetRgb` toward `direction` (in the
 * same RGB lerp space `lerpRgb`/`rgbToHex` use elsewhere) so the resulting
 * hex's similarityFromHex reading against the target lands at
 * `desiredSimilarity`. Falls back to nudging further from the target if hex
 * quantization rounds the result back above `hardCeiling`. */
function perturbToSimilarity(targetHex: string, desiredSimilarity: number, hardCeiling: number): string {
  const targetRgb = hexToRgb(targetHex);
  // A big, semi-random offset from the target so the lerp path (t in
  // [0, 1]) can reach anywhere from an exact match down to a near-total
  // miss.
  const direction: RGB = {
    r: 255 - targetRgb.r + (Math.random() - 0.5) * 60,
    g: 255 - targetRgb.g + (Math.random() - 0.5) * 60,
    b: 255 - targetRgb.b + (Math.random() - 0.5) * 60,
  };

  let lo = 0;
  let hi = 1;
  let hex = targetHex;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    hex = rgbToHex(lerpRgb(targetRgb, direction, mid));
    const sim = similarityFromHex(hex, targetHex);
    if (sim > desiredSimilarity) lo = mid; else hi = mid;
  }

  // The binary search converges in continuous space, but the final hex is
  // quantized to integer RGB channels — for very small perturbations that
  // rounding can occasionally snap back to (or above) the ceiling. Nudge
  // further along the same direction until the rendered hex is provably
  // at or under it.
  let mid = (lo + hi) / 2;
  let guard = 0;
  while (similarityFromHex(hex, targetHex) > hardCeiling && guard < 20) {
    mid = Math.min(1, mid + 0.03);
    hex = rgbToHex(lerpRgb(targetRgb, direction, mid));
    guard += 1;
  }
  return hex;
}

function pickHex(targetHex: string, difficulty: BotDifficulty, timeMode: BotTimeMode): string {
  if (timeMode === 'none' && Math.random() < NO_LIMIT_PERFECT_CHANCE) {
    return targetHex;
  }
  const band: TimeBand = timeMode === '2min' ? 'short' : 'long';
  const ceiling = ACCURACY_CEILING[difficulty][band];
  const floor = Math.max(5, ceiling - ACCURACY_SPREAD[difficulty]);
  const desiredSimilarity = floor + Math.random() * (ceiling - floor);
  return perturbToSimilarity(targetHex, desiredSimilarity, Math.min(ceiling, MAX_ACCURACY));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds the bot's full schedule of category picks for one round: when it
 * assigns each category (relative to round start, in ms) and what color it
 * lands on. Never instant (see distributeTimes), never late against a
 * deadline (see DEADLINE_SAFETY_MARGIN_MS), and — outside the no-limit
 * exception above — never perfectly accurate (see MAX_ACCURACY). */
export function computeBotSchedule({ difficulty, timeMode, categories }: ComputeBotScheduleOptions): BotPick[] {
  const config = TIME_MODE_CONFIG[timeMode];
  const jitter = (Math.random() * 2 - 1) * config.jitterMs;
  let finishMs = config.targetMs + jitter;
  if (config.deadlineMs !== null) {
    finishMs = Math.min(finishMs, config.deadlineMs - DEADLINE_SAFETY_MARGIN_MS);
  }

  const times = distributeTimes(categories.length, finishMs);

  return categories.map((cat, i) => ({
    categoryId: cat.id,
    atMs: times[i],
    hex: pickHex(cat.hex, difficulty, timeMode),
  }));
}
