// Theme-voting modal for private rooms with `themeMode: 'chosen'` (ticket
// #16). Opened by `ui/privateRoomFlow.ts` when a `vote:start` message
// arrives (see backend/src/rooms/themeVote.js / PROTOCOL.md "Theme
// voting"): both players get 10 seconds to pick a theme via the reused
// `ui/themeGrid.ts` grid, see a live "opponent's current pick" indicator,
// and only react to the final theme once `vote:settled` arrives — never
// earlier, even if both picks already match before the countdown ends.
//
// This module owns a single mount element for its own lifetime (fully
// replaces its `innerHTML` once, on open, then patches small pieces of it
// directly — unlike `privateRoomFlow.ts`'s per-state full-`innerHTML`
// pattern — because the live countdown tick and opponent-pick updates
// need to mutate DOM without tearing down and rebuilding the theme grid
// on every tick).

import { createThemeGrid } from './themeGrid';
import type { GameClient } from '../net/client';
import type { VoteSettledMessage, VoteStartMessage } from '../net/messages';
import type { ThemeId } from '../types';
import { THEMES } from '../data/themes';

/** How long the post-settle reveal animation (spin-between-picks, or the
 * "YOU AGREE!" celebration) plays before `onSettled` fires and the modal
 * tears itself down. Kept well under the 10s vote window so it never
 * overlaps a *second* vote's `vote:start` in the (currently impossible,
 * since a room only votes once per PROTOCOL.md) case of back-to-back
 * votes. */
const SETTLE_ANIMATION_MS = 1600;

export interface ThemeVoteHandle {
  /** Tears down the modal and its listeners/timers immediately, without
   * playing the settle animation or calling `onSettled` — for when the
   * room closes (opponent quit/disconnect) mid-vote. */
  destroy(): void;
}

function themeLabel(id: ThemeId): string {
  return THEMES[id].name;
}

function countdownText(msRemaining: number): string {
  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${seconds}s`;
}

/** Opens the vote modal into `mount` (a `.modal-overlay` element the
 * caller owns) for the given `vote:start` payload. Calls `onSettled`
 * exactly once, after the reveal animation completes, with the final
 * theme and whether both players agreed — the caller (`privateRoomFlow`)
 * uses this to know when it's safe to hand off to the match view, even
 * if `round:start` already arrived while the animation was still
 * playing. */
export function openThemeVote(
  client: GameClient,
  mount: HTMLElement,
  msg: VoteStartMessage,
  onSettled: (themeId: ThemeId, agreed: boolean) => void,
): ThemeVoteHandle {
  let settled = false;
  let myPick: ThemeId | null = null;

  mount.innerHTML = `
    <div class="modal theme-vote-modal">
      <h2>🗳 Pick a Theme</h2>
      <p class="theme-vote-countdown" data-el="countdown">${countdownText(msg.endsAt - Date.now())}</p>
      <div class="theme-vote-grid" data-el="grid"></div>
      <p class="theme-vote-opponent" data-el="opponent">Opponent is choosing…</p>
    </div>`;

  const countdownEl = mount.querySelector<HTMLElement>('[data-el="countdown"]')!;
  const gridEl = mount.querySelector<HTMLElement>('[data-el="grid"]')!;
  const opponentEl = mount.querySelector<HTMLElement>('[data-el="opponent"]')!;

  createThemeGrid(gridEl, msg.themeIds[0], (id) => {
    myPick = id;
    client.send({ type: 'vote:cast', themeId: id });
  });

  let countdownFrame = 0;
  function tickCountdown(): void {
    const remaining = msg.endsAt - Date.now();
    countdownEl.textContent = countdownText(remaining);
    if (remaining > 0) countdownFrame = requestAnimationFrame(tickCountdown);
  }
  tickCountdown();

  const unsubOpponent = client.on('vote:opponentChoice', (opp) => {
    opponentEl.textContent = `Opponent picked ${themeLabel(opp.themeId)}`;
  });

  function cleanupListeners(): void {
    cancelAnimationFrame(countdownFrame);
    unsubOpponent();
    unsubSettled();
  }

  function playSettleAnimation(settledMsg: VoteSettledMessage): void {
    countdownEl.textContent = '';
    if (settledMsg.agreed) {
      mount.innerHTML = `
        <div class="modal theme-vote-modal theme-vote-agree">
          <h2 class="theme-vote-agree-banner">🎉 YOU AGREE! 🎉</h2>
          <p class="theme-vote-settled-name">${themeLabel(settledMsg.themeId)}</p>
        </div>`;
    } else {
      mount.innerHTML = `
        <div class="modal theme-vote-modal theme-vote-spin">
          <h2>Settling…</h2>
          <p class="theme-vote-spin-name" data-el="spin-name">${myPick ? themeLabel(myPick) : ''}</p>
        </div>`;
      // A brief "spinning between the two picks" flourish: alternate the
      // displayed name a few times before landing on the real result.
      const spinEl = mount.querySelector<HTMLElement>('[data-el="spin-name"]')!;
      const candidates = [myPick, settledMsg.themeId].filter((id): id is ThemeId => id !== null);
      let i = 0;
      const spinInterval = window.setInterval(() => {
        i += 1;
        spinEl.textContent = themeLabel(candidates[i % candidates.length] ?? settledMsg.themeId);
      }, 180);
      window.setTimeout(() => {
        window.clearInterval(spinInterval);
        spinEl.textContent = themeLabel(settledMsg.themeId);
        spinEl.classList.add('theme-vote-spin-name-final');
      }, SETTLE_ANIMATION_MS - 300);
    }
    window.setTimeout(() => {
      onSettled(settledMsg.themeId, settledMsg.agreed);
    }, SETTLE_ANIMATION_MS);
  }

  const unsubSettled = client.on('vote:settled', (settledMsg) => {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(countdownFrame);
    unsubOpponent();
    unsubSettled();
    playSettleAnimation(settledMsg);
  });

  return {
    destroy(): void {
      if (settled) return;
      settled = true;
      cleanupListeners();
    },
  };
}
