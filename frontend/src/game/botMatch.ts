// Orchestrates one live solo-vs-bot round: drives the `OpponentView` split
// pane from a locally computed `computeBotSchedule` (see `engine/bot`)
// instead of network `round:progress` messages, then renders the same
// two-column scoreboard `MultiplayerMatch` uses once the round ends.
//
// Mirrors `multiplayerMatch.ts`'s shape and two-phase-init convention —
// `ThemeGuessGame` has no knowledge of this module either: `soloConfigFlow`
// supplies its `onCategoryAssigned` constructor callback and routes it into
// `BotMatch.handleLocalAssignment`, exactly like `MultiplayerMatch` docs
// describe. The one structural difference: there is no server, so this
// module also decides *when* the round ends (timer deadline, or — in
// no-limit mode, which has no deadline — once the bot's schedule has fully
// played out and the player has manually revealed via the existing Reveal
// button, matching how `ThemeGuessGame.reveal()` stays manually triggered
// for solo play in every time mode).

import { tokenize } from '../engine/tokenizer';
import { rgbToHex } from '../engine/colorUtils';
import { computeBotSchedule } from '../engine/bot';
import type { BotDifficulty, BotPick, BotTimeMode } from '../engine/bot';
import { CATEGORY_META, THEMES } from '../data/themes';
import { SNIPPETS } from '../data/snippets';
import type { CategoryId, CategoryStateMap, ThemeId } from '../types';
import { UNSET_BG_RGB, UNSET_FG_RGB } from './layoutConstants';
import { computeMatchResult } from './scoring';
import { renderMultiplayerResult } from './resultView';
import type { MultiplayerResultElements } from './resultView';
import { OpponentView } from './opponentView';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const FALLBACK_BG_HEX = rgbToHex(UNSET_BG_RGB);
const FALLBACK_FG_HEX = rgbToHex(UNSET_FG_RGB);

/** Every category defaulted to its "never painted" placeholder — pads a
 * partial submission (player or bot) at round end. Mirrors
 * `multiplayerMatch.ts`'s identically named helper. */
function defaultColorMap(): Record<CategoryId, string> {
  const result = {} as Record<CategoryId, string>;
  for (const def of CATEGORY_META) {
    result[def.id] = def.id === 'background' ? FALLBACK_BG_HEX : FALLBACK_FG_HEX;
  }
  return result;
}

/** Rebuilds the same per-category `weight`/`actualHex` derivation
 * `ThemeGuessGame`'s private `build()` does from a snippet + theme, then
 * layers a resolved color map (player's or bot's) over it so
 * `computeMatchResult` can score it — the animation-only fields are
 * filled with inert placeholders. Mirrors `multiplayerMatch.ts`'s
 * identically named helper. */
function buildCategoryStateMap(
  snippetIndex: number,
  themeId: ThemeId,
  colors: Record<CategoryId, string>,
): CategoryStateMap {
  const tokens = tokenize(SNIPPETS[snippetIndex]);
  const counts: Partial<Record<CategoryId, number>> = {};
  for (const t of tokens) {
    if (t.type === 'whitespace' || t.type === 'newline' || t.type === 'identifier') continue;
    const id = t.type as CategoryId;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  const maxCount = Math.max(1, ...Object.values(counts));
  const theme = THEMES[themeId];

  const categories = {} as CategoryStateMap;
  for (const def of CATEGORY_META) {
    const count = counts[def.id] ?? 0;
    const unset = def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB;
    categories[def.id] = {
      ...def,
      actualHex: theme.colors[def.id],
      weight: def.id === 'background' ? maxCount : Math.max(count, 3),
      count,
      assignedHex: colors[def.id] ?? null,
      currentRgb: { ...unset },
      fromRgb: { ...unset },
      toRgb: { ...unset },
      transitionStart: 0,
      pulsePhase: 0,
    };
  }
  return categories;
}

/** Deadline for the two clocked time modes, mirroring
 * `soloConfigFlow.ts`'s (unexported) `TIME_MODE_DEADLINE_MS` — kept as a
 * separate local copy since that module doesn't export it, matching this
 * codebase's existing per-module duplication of the same small constant
 * (see `multiplayerMatch.ts` vs `ThemeGuessGame.ts`'s category-map
 * builders). No-limit mode has no deadline, so no entry here. */
const ROUND_DEADLINE_MS: Record<Exclude<BotTimeMode, 'none'>, number> = {
  '1min': 60_000,
  '2min': 120_000,
};

export interface BotMatchConfig {
  themeId: ThemeId;
  snippetIndex: number;
  timeMode: BotTimeMode;
  difficulty: BotDifficulty;
}

export class BotMatch {
  private readonly splitView = requireEl<HTMLElement>('split-view');
  private readonly resultModal = requireEl<HTMLElement>('result-modal');
  private readonly mpScoreboard = requireEl<HTMLElement>('mp-scoreboard');
  private readonly soloResultEls = [
    requireEl<HTMLElement>('solo-score-meter-wrap'),
    requireEl<HTMLElement>('score-verdict'),
    requireEl<HTMLElement>('score-breakdown'),
    requireEl<HTMLElement>('compare-toggle'),
  ];
  private readonly mpResultElements: MultiplayerResultElements = {
    banner: requireEl<HTMLElement>('mp-winner-banner'),
    you: {
      number: requireEl<HTMLElement>('mp-you-number'),
      meter: requireEl<HTMLElement>('mp-you-meter'),
      breakdown: requireEl<HTMLElement>('mp-you-breakdown'),
    },
    opponent: {
      number: requireEl<HTMLElement>('mp-opponent-number'),
      meter: requireEl<HTMLElement>('mp-opponent-meter'),
      breakdown: requireEl<HTMLElement>('mp-opponent-breakdown'),
    },
  };
  private readonly revealBtn = requireEl<HTMLButtonElement>('reveal-btn');

  private opponentView: OpponentView | null = null;
  private schedule: BotPick[] = [];
  private pickTimeoutIds: number[] = [];
  private deadlineTimeoutId: number | null = null;
  private remainingPicks = 0;

  private themeId: ThemeId | null = null;
  private snippetIndex: number | null = null;
  private timeMode: BotTimeMode = 'none';
  private localColors: Partial<Record<CategoryId, string>> = {};

  private ended = true;
  private playerRevealed = false;
  private botFinished = false;

  constructor() {
    this.revealBtn.addEventListener('click', this.onRevealClick);
  }

  /** `ThemeGuessGame`'s `onCategoryAssigned` callback target: tracks the
   * local player's running color map for the eventual scoreboard. A
   * no-op once the round has already ended (or before one has started),
   * so it's safe to wire unconditionally regardless of the currently
   * selected solo opponent. */
  handleLocalAssignment(id: CategoryId, hex: string): void {
    if (this.ended) return;
    this.localColors[id] = hex;
  }

  /** Starts one bot round: shows the split-view pane, (re)builds the
   * `OpponentView` for `config.snippetIndex`, computes the bot's full
   * pick schedule against the theme's real per-category colors, and
   * schedules `opponentView.markAssigned` calls to play it out over
   * time. Tears down any previous round's timers first. */
  start(config: BotMatchConfig): void {
    this.teardown();
    this.ended = false;
    this.playerRevealed = false;
    this.botFinished = false;
    this.localColors = {};
    this.themeId = config.themeId;
    this.snippetIndex = config.snippetIndex;
    this.timeMode = config.timeMode;

    this.splitView.classList.remove('hidden');
    if (!this.opponentView) {
      this.opponentView = new OpponentView('opponent-canvas', config.snippetIndex);
    } else {
      this.opponentView.setSnippet(config.snippetIndex);
    }
    this.opponentView.reset();

    this.resultModal.classList.add('hidden');
    this.mpScoreboard.classList.add('hidden');

    const theme = THEMES[config.themeId];
    const categories = CATEGORY_META.map((def) => ({ id: def.id, hex: theme.colors[def.id] }));
    this.schedule = computeBotSchedule({
      difficulty: config.difficulty,
      timeMode: config.timeMode,
      categories,
    });
    this.remainingPicks = this.schedule.length;

    for (const pick of this.schedule) {
      const timeoutId = window.setTimeout(() => {
        this.opponentView?.markAssigned(pick.categoryId);
        this.remainingPicks -= 1;
        if (this.remainingPicks === 0) {
          this.botFinished = true;
          this.maybeEndNoLimitRound();
        }
      }, pick.atMs);
      this.pickTimeoutIds.push(timeoutId);
    }

    if (config.timeMode !== 'none') {
      this.deadlineTimeoutId = window.setTimeout(() => this.endRound(), ROUND_DEADLINE_MS[config.timeMode]);
    }
  }

  /** Hides the split-view pane and cancels any pending bot timers —
   * called when the solo player is on the 'Alone' path, so a previous
   * bot round's schedule/pane never bleeds into a single-pane round. */
  stop(): void {
    this.teardown();
    this.splitView.classList.add('hidden');
  }

  private readonly onRevealClick = (): void => {
    this.playerRevealed = true;
    this.maybeEndNoLimitRound();
  };

  /** No-limit mode has no deadline, so it ends only once both the bot's
   * schedule has fully played out and the player has manually revealed
   * (the existing Reveal button, same manual-trigger convention solo
   * play already uses in every time mode). */
  private maybeEndNoLimitRound(): void {
    if (this.timeMode === 'none' && this.playerRevealed && this.botFinished) this.endRound();
  }

  private endRound(): void {
    if (this.ended || this.snippetIndex === null || this.themeId === null) return;
    this.ended = true;
    this.clearTimers();

    const botColors: Record<CategoryId, string> = { ...defaultColorMap() };
    for (const pick of this.schedule) botColors[pick.categoryId] = pick.hex;
    const youColors: Record<CategoryId, string> = { ...defaultColorMap(), ...this.localColors };

    const youResult = computeMatchResult(buildCategoryStateMap(this.snippetIndex, this.themeId, youColors));
    const opponentResult = computeMatchResult(buildCategoryStateMap(this.snippetIndex, this.themeId, botColors));

    this.resultModal.classList.remove('hidden');
    for (const el of this.soloResultEls) el.classList.add('hidden');
    this.mpScoreboard.classList.remove('hidden');
    renderMultiplayerResult(this.mpResultElements, youResult, opponentResult);
  }

  /** Cancels every pending pick/deadline timeout. Idempotent — safe to
   * call before a round has started. */
  private clearTimers(): void {
    for (const id of this.pickTimeoutIds) window.clearTimeout(id);
    this.pickTimeoutIds = [];
    if (this.deadlineTimeoutId !== null) window.clearTimeout(this.deadlineTimeoutId);
    this.deadlineTimeoutId = null;
  }

  private teardown(): void {
    this.ended = true;
    this.clearTimers();
  }
}
