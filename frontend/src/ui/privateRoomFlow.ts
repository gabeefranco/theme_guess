// Private-room UI flow (ticket #15): "Create Room" (pick time/theme mode,
// get a shareable numeric code, wait for an opponent) and "Enter Code"
// (join an existing room by code, with an inline retry on a bad/full
// code) — see backend/src/PROTOCOL.md "Private rooms" for the wire
// contract this drives. Same composable-widget pattern as
// `ui/banBanner.ts`: owns a single mount element, fully re-renders its
// markup into it per state, and wires this render's own buttons fresh
// each time (nothing to leak — a replaced `innerHTML` drops the old
// listeners along with the old nodes).
//
// One `GameClient` is shared for the whole page (see `net/client.ts`),
// so `room:create`/`room:join`/`round:*` listeners here are registered
// once, for the module's lifetime, and gate their reaction on this
// flow's own `roomActive` flag — `round:start`/`round:nextMatch` are
// shared message types with matchmaking (ticket #14), which registers
// its own listeners on the same client, so this flow must never react
// to a round that belongs to a matchmaking match.
//
// Session component lifetime: exactly one `ThemeGuessGame` + one
// `OpponentView` + one `MultiplayerMatch` are constructed, lazily, the
// first time a room's first `round:start` arrives, then reused for
// every subsequent match in that room's up-to-5-match series by calling
// `match.startRound()` again — `MultiplayerMatch.startRound()` already
// tears down and re-subscribes its own per-round listeners/timer, so
// it's safe to call repeatedly on the same instance (confirmed by
// reading its source; no fix needed there for this). Constructing a
// *second* `ThemeGuessGame` for a later room, or for matchmaking, would
// double-bind its canvas/document event listeners onto the single
// shared `#code-canvas` — so this module's `game`/`opponentView`/`match`
// are deliberately never rebuilt once created, only reconfigured via
// `startRound`.
//
// Known cross-flow gap (see this ticket's final report): main.ts's own
// solo-mode `game` singleton is *separately* constructed by
// `soloConfigFlow`, hardcoding its `onCategoryAssigned` callback to
// `soloConfigFlow.handleLocalAssignment` forever. If a player plays Solo
// and then enters a private room in the same page load, this module
// necessarily constructs its *own* `ThemeGuessGame`, which double-binds
// listeners on the same `#code-canvas`/`#category-panel`/`document`
// solo's instance already bound. Fixing this needs a shared, swappable
// dispatch for `game`'s callback at the main.ts composition-root level
// (mirroring how `soloConfigFlow` already multiplexes "alone" vs "vs
// bot" internally) — out of this ticket's edit scope (main.ts's
// `game`/`soloConfigFlow` construction block is off-limits here, see
// this ticket's report).

import { THEMES } from '../data/themes';
import type { GameClient } from '../net/client';
import type {
  RoomClosedReason,
  RoomErrorReason,
  RoundNextMatchMessage,
  RoundStartMessage,
  ThemeMode,
  TimeMode,
} from '../net/messages';
import { MultiplayerMatch } from '../game/multiplayerMatch';
import { OpponentView } from '../game/opponentView';
import { ThemeGuessGame } from '../game/ThemeGuessGame';

export interface PrivateRoomFlowElements {
  /** Empty `.modal-overlay` mount (`#private-room-mount` in index.html)
   * this flow owns entirely — every state below is a full `innerHTML`
   * replacement into it. */
  mount: HTMLElement;
  /** Same theme-name badge the solo flow updates, kept in sync with the
   * server-assigned `themeId` once a round actually starts. */
  themeNameBadge: HTMLElement;
}

export interface PrivateRoomFlowCallbacks {
  /** Hides the main menu overlay — called when opening the create/join
   * sub-form (this flow's own overlay takes over) and again once a
   * match is actually live (both overlays clear, board underneath
   * shows). */
  hideMenu: () => void;
  /** Returns to the main menu overlay — cancel from any pre-match state,
   * or after dismissing a `room:closed` reason. */
  showMenu: () => void;
}

export interface PrivateRoomFlow {
  openCreate(): void;
  openJoin(): void;
}

type ViewState =
  | { kind: 'hidden' }
  | { kind: 'create-form' }
  | { kind: 'create-waiting'; code: number }
  | { kind: 'join-form'; error: RoomErrorReason | null }
  | { kind: 'vote-wait' }
  | { kind: 'match-transition'; match: number }
  | { kind: 'closed'; reason: RoomClosedReason };

const MATCH_TRANSITION_MS = 1400;

const ROOM_ERROR_TEXT: Record<RoomErrorReason, string> = {
  not_found: 'No room with that code — double check and try again.',
  full: 'That room already has two players.',
};

const ROOM_CLOSED_TEXT: Record<RoomClosedReason, string> = {
  quit: 'Your opponent left the room.',
  matchLimit: "You've played all 5 matches!",
  finished: 'The room has been closed.',
};

function radioValue(mount: HTMLElement, name: string, fallback: string): string {
  const checked = mount.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? fallback;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

/** Wires the Private menu section's two sub-flows into `elements.mount`.
 * `openCreate`/`openJoin` are this module's only entry points — call
 * them from the `#create-room-btn`/`#enter-code-btn` click handlers. */
export function createPrivateRoomFlow(
  client: GameClient,
  elements: PrivateRoomFlowElements,
  callbacks: PrivateRoomFlowCallbacks,
): PrivateRoomFlow {
  const { mount, themeNameBadge } = elements;

  let roomActive = false;
  let lastJoinCode = '';
  let transitionTimeoutId: number | null = null;

  let opponentView: OpponentView | null = null;
  let game: ThemeGuessGame | null = null;
  let match: MultiplayerMatch | null = null;
  const splitView = requireEl<HTMLElement>('split-view');

  function clearTransitionTimeout(): void {
    if (transitionTimeoutId !== null) {
      window.clearTimeout(transitionTimeoutId);
      transitionTimeoutId = null;
    }
  }

  /** Force-abandons a room the local player has no active round session
   * in yet (still waiting alone for an opponent, or theme voting is in
   * progress) — `player:quit` is a no-op server-side with no session to
   * attach it to (see backend/src/game/session.js), so the only way to
   * make the server actually free the room/notify an opponent already
   * in it is a real socket disconnect. `GameClient.on` subscriptions
   * live on the client instance, not the socket, so they survive this
   * reconnect untouched. */
  function abandonIdleRoom(): void {
    client.close();
    client.connect();
  }

  function render(state: ViewState): void {
    clearTransitionTimeout();

    if (state.kind === 'hidden') {
      mount.classList.add('hidden');
      mount.innerHTML = '';
      return;
    }

    mount.classList.remove('hidden');

    switch (state.kind) {
      case 'create-form':
        mount.innerHTML = `
          <div class="modal private-room-modal">
            <h2>🔒 Create Room</h2>
            <div class="solo-config-group">
              <p class="solo-config-label">⏱ TIME</p>
              <div class="solo-radio-row">
                <label class="solo-radio"><input type="radio" name="pr-time-mode" value="1" checked />1 MIN</label>
                <label class="solo-radio"><input type="radio" name="pr-time-mode" value="2" />2 MIN</label>
              </div>
            </div>
            <div class="solo-config-group">
              <p class="solo-config-label">🎨 THEME</p>
              <div class="solo-radio-row">
                <label class="solo-radio"><input type="radio" name="pr-theme-mode" value="random" checked />RANDOM</label>
                <label class="solo-radio"><input type="radio" name="pr-theme-mode" value="chosen" />VOTE TOGETHER</label>
              </div>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
              <button type="button" class="btn primary" data-action="submit">Create Room</button>
            </div>
          </div>`;
        mount.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
          callbacks.showMenu();
          render({ kind: 'hidden' });
        });
        mount.querySelector('[data-action="submit"]')!.addEventListener('click', () => {
          const timeMode = Number(radioValue(mount, 'pr-time-mode', '1')) as TimeMode;
          const themeMode = radioValue(mount, 'pr-theme-mode', 'random') as ThemeMode;
          client.send({ type: 'room:create', timeMode, themeMode });
        });
        break;

      case 'create-waiting': {
        const code = state.code;
        mount.innerHTML = `
          <div class="modal private-room-modal">
            <h2>Room Created</h2>
            <p>Share this code with your friend:</p>
            <div class="private-room-code-wrap">
              <span class="private-room-code">${code}</span>
              <button type="button" class="btn ghost small" data-action="copy">📋 Copy</button>
            </div>
            <p class="private-room-status">⏳ Waiting for opponent…</p>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
            </div>
          </div>`;
        const copyBtn = mount.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
        copyBtn.addEventListener('click', () => {
          if (!navigator.clipboard?.writeText) return;
          navigator.clipboard.writeText(String(code)).then(
            () => {
              const original = copyBtn.textContent;
              copyBtn.textContent = '✅ Copied!';
              window.setTimeout(() => { copyBtn.textContent = original; }, 1500);
            },
            () => {},
          );
        });
        mount.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
          abandonIdleRoom();
          callbacks.showMenu();
          render({ kind: 'hidden' });
        });
        break;
      }

      case 'join-form':
        mount.innerHTML = `
          <div class="modal private-room-modal">
            <h2>Enter Code</h2>
            <div class="private-room-join-row">
              <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
                class="private-room-code-input" placeholder="123456" value="${lastJoinCode}" />
              <button type="button" class="btn primary" data-action="submit">Join</button>
            </div>
            <p class="private-room-error${state.error ? '' : ' hidden'}">${state.error ? ROOM_ERROR_TEXT[state.error] : ''}</p>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
            </div>
          </div>`;
        {
          const input = mount.querySelector<HTMLInputElement>('.private-room-code-input')!;
          input.addEventListener('input', () => { lastJoinCode = input.value.replace(/\D/g, ''); input.value = lastJoinCode; });
          input.focus();
          const submit = (): void => {
            const code = Number(lastJoinCode);
            if (!lastJoinCode || Number.isNaN(code)) return;
            client.send({ type: 'room:join', code });
          };
          mount.querySelector('[data-action="submit"]')!.addEventListener('click', submit);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        }
        mount.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
          lastJoinCode = '';
          callbacks.showMenu();
          render({ kind: 'hidden' });
        });
        break;

      case 'vote-wait':
        // TODO(#16): replace with real theme-vote modal (pick from
        // `vote:start.themeIds`, live opponent-choice indicator via
        // `vote:opponentChoice`). This ticket only needs to not hang —
        // `round:start` (below) always follows `vote:settled`.
        mount.innerHTML = `
          <div class="modal private-room-modal private-room-vote-wait">
            <h2>🗳 Theme Vote</h2>
            <p class="private-room-status">Waiting for theme vote to settle…</p>
            <div class="modal-actions">
              <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
            </div>
          </div>`;
        mount.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
          abandonIdleRoom();
          callbacks.showMenu();
          render({ kind: 'hidden' });
        });
        break;

      case 'match-transition':
        mount.innerHTML = `
          <div class="modal private-room-modal private-room-transition">
            <h2>Match ${state.match} of 5</h2>
          </div>`;
        transitionTimeoutId = window.setTimeout(() => {
          transitionTimeoutId = null;
          render({ kind: 'hidden' });
        }, MATCH_TRANSITION_MS);
        break;

      case 'closed':
        mount.innerHTML = `
          <div class="modal private-room-modal">
            <h2>Room Closed</h2>
            <p class="private-room-status">${ROOM_CLOSED_TEXT[state.reason]}</p>
            <div class="modal-actions">
              <button type="button" class="btn primary" data-action="menu">Back to Menu</button>
            </div>
          </div>`;
        mount.querySelector('[data-action="menu"]')!.addEventListener('click', () => {
          callbacks.showMenu();
          render({ kind: 'hidden' });
        });
        break;
    }
  }

  /** Lazily builds (once, ever, for this flow) the `OpponentView` +
   * `MultiplayerMatch` + `ThemeGuessGame` trio, following
   * `multiplayerMatch.ts`'s documented two-phase-init order, then reuses
   * them for every later `round:start` this room sends. */
  function ensureMatch(payload: RoundStartMessage): MultiplayerMatch {
    if (match && game) return match;

    opponentView = new OpponentView('opponent-canvas', payload.snippetIndex);
    match = new MultiplayerMatch(client, opponentView, () => {
      // Local player quit mid-round: per PROTOCOL.md "Quit", the
      // quitter gets no room:closed of their own (only the remaining
      // player does) — so this is the definitive "I've left" signal,
      // not something to wait on a server reply for.
      roomActive = false;
      callbacks.showMenu();
      render({ kind: 'hidden' });
    });
    game = new ThemeGuessGame(payload.themeId, payload.snippetIndex, (id, hex) => match!.handleLocalAssignment(id, hex));
    match.bindGame(game);
    return match;
  }

  client.on('room:created', (msg) => {
    render({ kind: 'create-waiting', code: msg.code });
  });

  client.on('room:error', (msg) => {
    render({ kind: 'join-form', error: msg.reason });
  });

  client.on('room:joined', (msg) => {
    roomActive = true;
    if (msg.themeMode === 'chosen') {
      render({ kind: 'vote-wait' });
    } else {
      render({ kind: 'hidden' });
      callbacks.hideMenu();
    }
  });

  client.on('round:nextMatch', (msg: RoundNextMatchMessage) => {
    if (!roomActive) return;
    render({ kind: 'match-transition', match: msg.match });
  });

  client.on('round:start', (payload) => {
    if (!roomActive) return;
    render({ kind: 'hidden' });
    callbacks.hideMenu();
    themeNameBadge.textContent = THEMES[payload.themeId].name;
    ensureMatch(payload).startRound(payload);
  });

  client.on('room:closed', (msg) => {
    roomActive = false;
    // The opponent's own `MultiplayerMatch.teardownRound()` never ran
    // for this abandoned round (only the quitter's local instance tore
    // its round down) — hide the stale split-view pane here so it
    // doesn't linger behind the closed-room banner / re-shown menu.
    splitView.classList.add('hidden');
    render({ kind: 'closed', reason: msg.reason });
  });

  return {
    openCreate(): void {
      callbacks.hideMenu();
      render({ kind: 'create-form' });
    },
    openJoin(): void {
      lastJoinCode = '';
      callbacks.hideMenu();
      render({ kind: 'join-form', error: null });
    },
  };
}
