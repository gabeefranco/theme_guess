// Wires the Matchmaking menu section's "Find Match" flow: queue:join /
// queue:leave, the banned-state countdown (ui/banBanner.ts), a brief
// "N MINUTE MATCH" reveal once matched, and the handoff into
// game/multiplayerMatch.ts's `MultiplayerMatch` (see that module's
// header for the two-phase `MultiplayerMatch` / `ThemeGuessGame`
// construction order this mirrors). PROTOCOL.md describes `round:start`
// as following `match:found`, but the real `queue.js` implementation
// sends them in the opposite order — see the `foundAt`/`roundStartPayload`
// handling below, which treats both orderings identically.
//
// Owns a single `OpponentView` / `ThemeGuessGame` / `MultiplayerMatch`
// trio for the lifetime of the page, constructed lazily on the first
// matchmaking round and reused (`setTheme`/`setSnippet`) on every
// subsequent one — mirroring how `ui/soloConfigFlow.ts` reuses a single
// `ThemeGuessGame` across solo replays. `ThemeGuessGame`'s constructor
// binds fresh DOM listeners every time it's called, so constructing a
// second one while a first is still alive (e.g. mixing solo/bot play
// with matchmaking in the same page load) would double up event
// handling; out of scope here, same single-orchestrator assumption
// `game/multiplayerMatch.ts`'s header documents.

import { ThemeGuessGame } from '../game/ThemeGuessGame';
import { MultiplayerMatch } from '../game/multiplayerMatch';
import { OpponentView } from '../game/opponentView';
import { THEMES } from '../data/themes';
import type { GameClient } from '../net/client';
import type { RoundStartMessage, TimeMode } from '../net/messages';
import { renderBanBanner } from './banBanner';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

export interface MatchmakingFlowElements {
  findMatchBtn: HTMLButtonElement;
  /** Dedicated mount inside `#menu-matchmaking` for the dynamic
   * searching / banned / mode-found states (see index.html). Hidden
   * whenever `findMatchBtn` is showing its idle state. */
  statusMount: HTMLElement;
  themeNameBadge: HTMLElement;
}

export interface MatchmakingFlowHooks {
  /** Hides every overlay screen so the board (and, once
   * `MultiplayerMatch` shows it, the opponent split-view) becomes
   * visible — mirrors `showView(null)` in main.ts. */
  showBoard: () => void;
  /** Reveals the main menu overlay again — mirrors `showView('menu')`
   * in main.ts. */
  showMenu: () => void;
}

type FlowState = 'idle' | 'searching' | 'banned' | 'found' | 'in-match';

const TIME_MODE_LABEL: Record<TimeMode, string> = {
  1: '🎯 1 MINUTE MATCH',
  2: '🎯 2 MINUTE MATCH',
};

/** Minimum time the assigned-mode banner stays up before handing off to
 * `MultiplayerMatch` — `match:found`/`round:start` can arrive within the
 * same tick (see this module's header), so without a floor here the
 * mode banner could be effectively invisible. */
const MODE_REVEAL_MIN_MS = 1500;

/** Wires `elements.findMatchBtn` into the real matchmaking flow
 * described in this module's header. Nothing needs to be exposed back
 * to the caller — every transition is driven by `client` events and DOM
 * clicks — so, like `ui/previewFlow.ts`, this returns nothing. */
export function createMatchmakingFlow(
  elements: MatchmakingFlowElements,
  client: GameClient,
  hooks: MatchmakingFlowHooks,
): void {
  const { findMatchBtn, statusMount, themeNameBadge } = elements;
  const closeResultBtn = requireEl<HTMLButtonElement>('close-result-btn');
  const playAgainBtn = requireEl<HTMLButtonElement>('play-again-btn');

  let state: FlowState = 'idle';
  let stopBanBanner: (() => void) | null = null;
  let banExpiryTimeoutId: number | null = null;
  let modeRevealTimeoutId: number | null = null;
  // `backend/src/matchmaking/queue.js`'s `tryMatch()` actually sends
  // `round:start` (via `createSession`) *before* `match:found`, the
  // reverse of PROTOCOL.md's stated "match:found, then round:start"
  // ordering — so both of these are tracked independently and the
  // handoff below fires once both are known, regardless of which
  // arrived first.
  let foundAt: number | null = null;
  let roundStartPayload: RoundStartMessage | null = null;
  let handoffScheduled = false;

  /** Set once a round:reveal ends an active matchmaking match, so the
   * next `close-result-btn`/`play-again-btn` click (both shared, global
   * result-modal buttons — see `game/ThemeGuessGame.ts`) routes back to
   * the menu instead of just closing the modal. Left `false` the rest
   * of the time so solo/bot result dismissals are unaffected. */
  let awaitingMenuReturn = false;

  // Lazily constructed on the first matchmaking round, then reused for
  // every subsequent one this page load — see this module's header.
  let opponentView: OpponentView | null = null;
  let match: MultiplayerMatch | null = null;
  let game: ThemeGuessGame | null = null;

  function clearBanTimers(): void {
    stopBanBanner?.();
    stopBanBanner = null;
    if (banExpiryTimeoutId !== null) {
      window.clearTimeout(banExpiryTimeoutId);
      banExpiryTimeoutId = null;
    }
  }

  function clearModeRevealTimer(): void {
    if (modeRevealTimeoutId !== null) {
      window.clearTimeout(modeRevealTimeoutId);
      modeRevealTimeoutId = null;
    }
  }

  function hideStatus(): void {
    statusMount.innerHTML = '';
    statusMount.classList.add('hidden');
  }

  function renderIdle(): void {
    state = 'idle';
    clearBanTimers();
    clearModeRevealTimer();
    foundAt = null;
    roundStartPayload = null;
    handoffScheduled = false;
    hideStatus();
    findMatchBtn.classList.remove('hidden');
  }

  function renderSearching(): void {
    state = 'searching';
    findMatchBtn.classList.add('hidden');
    statusMount.innerHTML = `
      <p class="matchmaking-status-text">🔎 Searching for opponent…</p>
      <button type="button" id="matchmaking-cancel-btn" class="btn ghost small">Cancel</button>`;
    statusMount.classList.remove('hidden');
    statusMount.querySelector<HTMLButtonElement>('#matchmaking-cancel-btn')!
      .addEventListener('click', handleCancelClick);
  }

  function renderBanned(bannedUntil: number): void {
    state = 'banned';
    clearModeRevealTimer();
    findMatchBtn.classList.add('hidden');
    clearBanTimers();
    stopBanBanner = renderBanBanner(statusMount, bannedUntil);
    // renderBanBanner's own interval self-clears at expiry; this timer
    // just re-enables Find Match at (essentially) the same moment,
    // since renderBanBanner exposes no "expired" callback of its own.
    const remaining = Math.max(0, bannedUntil - Date.now());
    banExpiryTimeoutId = window.setTimeout(() => renderIdle(), remaining + 250);
  }

  function renderModeFound(timeMode: TimeMode): void {
    state = 'found';
    findMatchBtn.classList.add('hidden');
    statusMount.innerHTML = `<p class="matchmaking-status-text matchmaking-mode-found">${TIME_MODE_LABEL[timeMode]}</p>`;
    statusMount.classList.remove('hidden');
  }

  function handleCancelClick(): void {
    if (state !== 'searching') return;
    client.send({ type: 'queue:leave' });
    renderIdle();
  }

  function returnToMenu(): void {
    renderIdle();
    hooks.showMenu();
  }

  /** `MultiplayerMatch`'s `onQuit`: the local player's own quit already
   * tore the match down with no result modal to wait for, so head
   * straight back to the menu. */
  function handleLocalQuit(): void {
    if (state !== 'in-match') return;
    returnToMenu();
  }

  function startMatch(payload: RoundStartMessage): void {
    modeRevealTimeoutId = null;
    state = 'in-match';
    hideStatus();
    themeNameBadge.textContent = THEMES[payload.themeId].name;

    if (!opponentView) opponentView = new OpponentView('opponent-canvas', payload.snippetIndex);
    if (!match) match = new MultiplayerMatch(client, opponentView, handleLocalQuit);
    if (!game) {
      game = new ThemeGuessGame(payload.themeId, payload.snippetIndex, (id, hex) => match!.handleLocalAssignment(id, hex));
      match.bindGame(game);
    } else {
      game.setTheme(payload.themeId);
      game.setSnippet(payload.snippetIndex);
    }

    hooks.showBoard();
    match.startRound(payload);
  }

  findMatchBtn.addEventListener('click', () => {
    if (state !== 'idle') return;
    client.send({ type: 'queue:join' });
    renderSearching();
  });

  client.on('queue:banned', (msg) => {
    if (state !== 'searching' && state !== 'idle') return;
    renderBanned(msg.bannedUntil);
  });

  function noteFound(timeMode: TimeMode): void {
    if (foundAt !== null) return; // already noted by the other message
    foundAt = Date.now();
    renderModeFound(timeMode);
  }

  function maybeScheduleHandoff(): void {
    if (handoffScheduled || foundAt === null || !roundStartPayload) return;
    handoffScheduled = true;
    const payload = roundStartPayload;
    const remaining = Math.max(0, foundAt + MODE_REVEAL_MIN_MS - Date.now());
    modeRevealTimeoutId = window.setTimeout(() => startMatch(payload), remaining);
  }

  client.on('match:found', (msg) => {
    if (state !== 'searching' && state !== 'found') return;
    noteFound(msg.timeMode);
    maybeScheduleHandoff();
  });

  // `round:start` also fires for private-room matches on this same
  // shared `client`; those are ignored here because this flow is only
  // ever in 'searching'/'found' state while genuinely waiting on a
  // matchmaking match (see this module's header for why `round:start`
  // alone — not `match:found` — is treated as authoritative for the
  // handoff timing).
  client.on('round:start', (payload) => {
    if (state !== 'searching' && state !== 'found') return;
    noteFound(payload.timeMode);
    roundStartPayload = payload;
    maybeScheduleHandoff();
  });

  // Matchmaking is single-round (PROTOCOL.md "Matchmaking": both
  // players return to Idle after round:reveal), so this is always the
  // natural end of an active match — wait for the result modal
  // (already shown by `MultiplayerMatch.handleReveal`) to be dismissed
  // before actually navigating back to the menu, so the two DOM
  // mutations don't race (see close/play-again handlers below).
  client.on('round:reveal', () => {
    if (state !== 'in-match') return;
    renderIdle();
    awaitingMenuReturn = true;
  });

  // Opponent quit or disconnected mid-round: game/session.js sends
  // room:playerLeft then room:closed to the remaining player, which
  // `MultiplayerMatch` itself never listens for (see its header) — no
  // round:reveal will ever arrive for this match, so go straight back,
  // there's no result modal to wait for.
  client.on('room:closed', () => {
    if (state !== 'in-match') return;
    returnToMenu();
  });

  const handleResultDismiss = (): void => {
    if (!awaitingMenuReturn) return;
    awaitingMenuReturn = false;
    hooks.showMenu();
  };
  closeResultBtn.addEventListener('click', handleResultDismiss);
  playAgainBtn.addEventListener('click', handleResultDismiss);
}
