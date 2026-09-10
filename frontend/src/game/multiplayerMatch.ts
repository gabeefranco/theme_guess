// Orchestrates one live multiplayer round: wires an existing
// `ThemeGuessGame` + `OpponentView` + `timerHud` to a `GameClient`'s
// round:start/round:progress/round:timeWarning/round:reveal messages
// (see backend/src/PROTOCOL.md), and renders the two-column scoreboard
// once the server reveals both players' submissions. Also owns the
// in-match Quit button (`#match-quit-btn`): a confirm-armed click sends
// `player:quit` and tears the local view down immediately, no server
// reply required (see `quit()`'s doc for why).
//
// `ThemeGuessGame` has no network knowledge of its own: this module
// supplies its `onCategoryAssigned` constructor callback (see
// `ThemeGuessGame`'s constructor doc) and routes it into
// `handleLocalAssignment`. Composition therefore happens in two steps —
// construct `MultiplayerMatch` first, then construct `ThemeGuessGame`
// with `(id, hex) => match.handleLocalAssignment(id, hex)`, then call
// `match.bindGame(game)` — so the callback closure can reference a
// `MultiplayerMatch` instance that already exists.
//
// Nothing constructs a `MultiplayerMatch` yet (no #14/#15 host exists
// in main.ts) — the third constructor arg, `onQuit`, is this class's
// own hook for that future host to route back to the main menu once a
// quit completes; it's exercised by this ticket's own quit-button
// wiring so it's ready for #14/#15 to pass in.

import { tokenize } from '../engine/tokenizer';
import { rgbToHex } from '../engine/colorUtils';
import { CATEGORY_META, THEMES } from '../data/themes';
import { SNIPPETS } from '../data/snippets';
import { getOrCreatePlayerId } from '../net/identity';
import type { GameClient } from '../net/client';
import type { RoundRevealMessage, RoundStartMessage } from '../net/messages';
import type { CategoryId, CategoryStateMap, ThemeId } from '../types';
import { UNSET_BG_RGB, UNSET_FG_RGB } from './layoutConstants';
import { showTimeWarning, startCountdown } from './timerHud';
import { computeMatchResult } from './scoring';
import { renderMultiplayerResult } from './resultView';
import type { OpponentView } from './opponentView';
import type { ThemeGuessGame } from './ThemeGuessGame';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const FALLBACK_BG_HEX = rgbToHex(UNSET_BG_RGB);
const FALLBACK_FG_HEX = rgbToHex(UNSET_FG_RGB);

/** How long the Quit button stays "armed" (showing "Confirm Quit?")
 * after a first click before reverting, so a stray double-tap can't
 * quit a match by accident. */
const QUIT_CONFIRM_WINDOW_MS = 3000;

/** Every category defaulted to its "never painted" placeholder — used
 * both to pad a local submission that's missing categories at time-up,
 * and to stand in for an opponent who never submitted at all. */
function defaultColorMap(): Record<CategoryId, string> {
  const result = {} as Record<CategoryId, string>;
  for (const def of CATEGORY_META) {
    result[def.id] = def.id === 'background' ? FALLBACK_BG_HEX : FALLBACK_FG_HEX;
  }
  return result;
}

/** Rebuilds the same per-category `weight`/`actualHex` derivation
 * `ThemeGuessGame`'s private `build()` does from a snippet + theme, then
 * overlays a submitted color map as `assignedHex`. `computeMatchResult`
 * only reads `assignedHex`/`actualHex`/`weight`/`id` off a
 * `CategoryStateMap`, so this lets `round:reveal` be scored for either
 * player without `ThemeGuessGame` needing to expose its internal state —
 * the animation-only fields are filled with inert placeholders. */
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

export class MultiplayerMatch {
  private readonly localPlayerId = getOrCreatePlayerId();

  private readonly timerEl = requireEl<HTMLElement>('match-timer-hud');
  private readonly timerWarningEl = requireEl<HTMLElement>('match-timer-warning');
  private readonly quitBtn = requireEl<HTMLButtonElement>('match-quit-btn');
  private readonly resultModal = requireEl<HTMLElement>('result-modal');
  private readonly mpScoreboard = requireEl<HTMLElement>('mp-scoreboard');
  private readonly soloResultEls = [
    requireEl<HTMLElement>('solo-score-meter-wrap'),
    requireEl<HTMLElement>('score-verdict'),
    requireEl<HTMLElement>('score-breakdown'),
    requireEl<HTMLElement>('compare-toggle'),
  ];
  private readonly mpResultElements = {
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

  private game: ThemeGuessGame | null = null;
  private themeId: ThemeId | null = null;
  private snippetIndex: number | null = null;
  private localColors: Partial<Record<CategoryId, string>> = {};

  private stopTimer: (() => void) | null = null;
  private unsubProgress: (() => void) | null = null;
  private unsubWarning: (() => void) | null = null;
  private unsubReveal: (() => void) | null = null;

  private quitArmed = false;
  private quitArmTimeoutId: number | null = null;

  /** `onQuit`, if given, fires once the local player's quit actually
   * goes through (button confirmed, `player:quit` sent, local view torn
   * down) — the host of this `MultiplayerMatch` (main.ts or whatever
   * mounts it; nothing does yet, see this class's header) uses it to
   * route back to the main menu. Never fires for the remote end of a
   * match ending (opponent quit, reveal, etc.) — this class doesn't
   * listen for `room:playerLeft`/`room:closed` today. */
  constructor(
    private readonly client: GameClient,
    private readonly opponentView: OpponentView,
    private readonly onQuit?: () => void,
  ) {
    this.quitBtn.addEventListener('click', () => this.handleQuitClick());
  }

  /** Binds the `ThemeGuessGame` this match drives via `setSnippet`/
   * `setTheme`. Must be constructed with its `onCategoryAssigned`
   * pointed at this instance's `handleLocalAssignment` — see this
   * module's header comment for the construction order. */
  bindGame(game: ThemeGuessGame): void {
    this.game = game;
  }

  /** `ThemeGuessGame`'s `onCategoryAssigned` callback target: tracks the
   * local player's running color map (for the eventual `round:submit`)
   * and relays a bare `round:progress` — never a color — to the
   * opponent, per protocol. */
  handleLocalAssignment(id: CategoryId, hex: string): void {
    this.localColors[id] = hex;
    this.client.send({ type: 'round:progress', categoryId: id });
  }

  /** Starts one round from a `round:start` payload: syncs the local
   * board and opponent pane to the server-assigned snippet/theme, starts
   * the countdown, and wires this round's progress/timeWarning/reveal
   * listeners. Tears down any previous round's listeners/timer first. */
  startRound(payload: RoundStartMessage): void {
    if (!this.game) throw new Error('MultiplayerMatch: no ThemeGuessGame bound; call bindGame() first');

    this.teardownRound();
    this.localColors = {};
    this.themeId = payload.themeId;
    this.snippetIndex = payload.snippetIndex;

    this.game.setTheme(payload.themeId);
    this.game.setSnippet(payload.snippetIndex);
    this.opponentView.setSnippet(payload.snippetIndex);
    this.opponentView.reset();

    this.resultModal.classList.add('hidden');
    this.mpScoreboard.classList.add('hidden');

    this.unsubProgress = this.client.on('round:progress', (msg) => {
      this.opponentView.markAssigned(msg.categoryId);
    });
    this.unsubWarning = this.client.on('round:timeWarning', () => {
      showTimeWarning(this.timerWarningEl);
    });
    this.unsubReveal = this.client.on('round:reveal', (msg) => {
      this.handleReveal(msg);
    });

    this.stopTimer = startCountdown(this.timerEl, {
      timeMode: payload.timeMode,
      endsAt: payload.endsAt,
      onExpire: () => this.submitFinalColors(),
    });

    this.quitBtn.classList.remove('hidden');
  }

  /** Pads the tracked local color map with placeholders for any
   * category the player never assigned, so `round:submit` always
   * carries a full `Record<CategoryId, string>`. */
  private finalizeColors(): Record<CategoryId, string> {
    return { ...defaultColorMap(), ...this.localColors };
  }

  private submitFinalColors(): void {
    this.client.send({ type: 'round:submit', colors: this.finalizeColors() });
  }

  private handleReveal(msg: RoundRevealMessage): void {
    if (this.snippetIndex === null || this.themeId === null) return;

    const opponentId = Object.keys(msg.colors).find((id) => id !== this.localPlayerId) ?? null;
    const youColors = msg.colors[this.localPlayerId] ?? this.finalizeColors();
    const opponentColors = (opponentId && msg.colors[opponentId]) || defaultColorMap();

    const youResult = computeMatchResult(buildCategoryStateMap(this.snippetIndex, this.themeId, youColors));
    const opponentResult = computeMatchResult(
      buildCategoryStateMap(this.snippetIndex, this.themeId, opponentColors),
    );

    this.teardownRound();

    this.resultModal.classList.remove('hidden');
    for (const el of this.soloResultEls) el.classList.add('hidden');
    this.mpScoreboard.classList.remove('hidden');
    renderMultiplayerResult(this.mpResultElements, youResult, opponentResult);
  }

  /** Stops the countdown and unsubscribes this round's listeners.
   * Idempotent — safe to call before a round has started. */
  private teardownRound(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.unsubProgress?.();
    this.unsubProgress = null;
    this.unsubWarning?.();
    this.unsubWarning = null;
    this.unsubReveal?.();
    this.unsubReveal = null;

    this.disarmQuit();
    this.quitBtn.classList.add('hidden');
  }

  /** First click on the Quit button arms it (shows "Confirm Quit?" and
   * reverts on its own after `QUIT_CONFIRM_WINDOW_MS`); a second click
   * while armed actually quits. Requires two intentional clicks so a
   * misclick can't forfeit a match by accident. */
  private handleQuitClick(): void {
    if (this.quitArmed) {
      this.quit();
      return;
    }
    this.armQuit();
  }

  private armQuit(): void {
    this.quitArmed = true;
    this.quitBtn.textContent = 'Confirm Quit?';
    this.quitBtn.classList.add('armed');
    this.quitArmTimeoutId = window.setTimeout(() => this.disarmQuit(), QUIT_CONFIRM_WINDOW_MS);
  }

  private disarmQuit(): void {
    this.quitArmed = false;
    this.quitBtn.textContent = '✕ Quit';
    this.quitBtn.classList.remove('armed');
    if (this.quitArmTimeoutId !== null) {
      window.clearTimeout(this.quitArmTimeoutId);
      this.quitArmTimeoutId = null;
    }
  }

  /** Confirmed quit: sends `player:quit` (see PROTOCOL.md "Quit" — the
   * server infers which match/room from the sending socket, no payload
   * needed), then immediately tears down the local match view exactly
   * as `handleReveal` does, without waiting for any server reply — a
   * quit has no round:reveal to wait for. Note there is no ban-info
   * reply to react to here: see `ui/banBanner.ts`'s header comment for
   * why a matchmaking ban is only ever learned later, via `queue:banned`
   * on a subsequent `queue:join`. */
  private quit(): void {
    this.client.send({ type: 'player:quit' });
    this.teardownRound();
    this.opponentView.reset();
    this.onQuit?.();
  }
}
