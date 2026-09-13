// Orchestrates one live solo-vs-bot round: drives the `OpponentView` split
// pane from a locally computed `computeBotSchedule` (see `engine/bot`)
// instead of network `round:progress` messages, then renders the same
// two-column scoreboard `MultiplayerMatch` uses once the round ends.
//
// Mirrors `multiplayerMatch.ts`'s shape and two-phase-init convention —
// `ThemeGuessGame` has no knowledge of this module's existence (it never
// imports `BotMatch`): `soloConfigFlow` supplies its `onCategoryAssigned`
// constructor callback and routes it into `BotMatch.handleLocalAssignment`,
// exactly like `MultiplayerMatch` docs describe, and separately binds the
// shared instance itself via `bindGame` so the Reveal button can be gated
// on the ground-truth `isFullyAssigned()` (see `syncRevealAvailability`)
// instead of shadowing that state locally. The one structural difference
// from multiplayer: there is no server, so this module also decides
// *when* the round ends — the timed modes' deadline, same as always, or
// (in any mode) as soon as both the bot's schedule has fully played out
// and the player has manually revealed via the Reveal button, which
// `syncRevealAvailability` keeps disabled until exactly that point.

import { tokenize } from '../engine/tokenizer';
import { computeCategoryStats } from '../engine/categoryStats';
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
import type { ThemeGuessGame } from './ThemeGuessGame';

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
  const { counts, weights } = computeCategoryStats(tokenize(SNIPPETS[snippetIndex]));
  const theme = THEMES[themeId];

  const categories = {} as CategoryStateMap;
  for (const def of CATEGORY_META) {
    const unset = def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB;
    categories[def.id] = {
      ...def,
      actualHex: theme.colors[def.id],
      weight: weights[def.id],
      count: counts[def.id],
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
  '2min': 120_000,
  '4min': 240_000,
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

  private game: ThemeGuessGame | null = null;

  private opponentView: OpponentView | null = null;
  private schedule: BotPick[] = [];
  private pickTimeoutIds: number[] = [];
  private deadlineTimeoutId: number | null = null;
  private remainingPicks = 0;

  private themeId: ThemeId | null = null;
  private snippetIndex: number | null = null;
  private localColors: Partial<Record<CategoryId, string>> = {};

  private ended = true;
  private playerRevealed = false;
  private botFinished = false;

  constructor() {
    this.revealBtn.addEventListener('click', this.onRevealClick);
  }

  /** Binds the shared `ThemeGuessGame` this match's Reveal-button gating
   * polls — see `syncRevealAvailability`. Must be called before `start`;
   * `soloConfigFlow` does this right after every `getSharedGame` call,
   * bot round or not, since it's a harmless no-op while `ended`. */
  bindGame(game: ThemeGuessGame): void {
    this.game = game;
  }

  /** `ThemeGuessGame`'s `onCategoryAssigned` callback target: tracks the
   * local player's running color map for the eventual scoreboard, and
   * re-syncs Reveal-button availability (the player finishing their own
   * board is one of the two conditions it's gated on — see
   * `syncRevealAvailability`). A no-op once the round has already ended
   * (or before one has started), so it's safe to wire unconditionally
   * regardless of the currently selected solo opponent. */
  handleLocalAssignment(id: CategoryId, hex: string): void {
    if (this.ended) return;
    this.localColors[id] = hex;
    this.syncRevealAvailability();
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

    this.splitView.classList.remove('hidden');
    if (!this.opponentView) {
      this.opponentView = new OpponentView('opponent-canvas', config.snippetIndex);
    } else {
      this.opponentView.setSnippet(config.snippetIndex);
    }
    this.opponentView.reset();

    this.resultModal.classList.add('hidden');
    this.mpScoreboard.classList.add('hidden');
    this.syncRevealAvailability();

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
          this.syncRevealAvailability();
          this.maybeEndRound();
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

  /** Reveal is only ever enabled while a bot round is live and both
   * sides have finished — the player's own board (per `ThemeGuessGame`'s
   * ground-truth `isFullyAssigned`, not `localColors`, so a mid-round
   * `resetColors()` can't leave this stuck enabled) and the bot's
   * schedule. Runs after every local assignment and the bot's final
   * pick — the two events that can flip either half of the condition. */
  private syncRevealAvailability(): void {
    if (this.ended) return;
    const playerDone = this.game?.isFullyAssigned() ?? false;
    this.revealBtn.disabled = !(playerDone && this.botFinished);
  }

  private readonly onRevealClick = (): void => {
    this.playerRevealed = true;
    this.maybeEndRound();
  };

  /** Ends the round as soon as both sides are done and the player has
   * manually revealed — the Reveal button is disabled until exactly
   * that point (see `syncRevealAvailability`), so this fires the moment
   * it's clicked, timed mode or not, instead of making the player wait
   * out a deadline neither side needs anymore. A timed round whose
   * deadline arrives first still ends itself via `endRound` regardless. */
  private maybeEndRound(): void {
    if (this.playerRevealed && this.botFinished) this.endRound();
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
