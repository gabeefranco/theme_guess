// Standalone "matchmaking ban" countdown banner.
//
// Integration point (read this before wiring it up): the ONLY wire
// message that carries ban info is `queue:banned` (see
// backend/src/PROTOCOL.md "Matchmaking" + "Quit"), which the server
// sends in reply to a `queue:join` attempt made while banned. Quitting a
// matchmaking match does NOT itself push any ban notification to the
// quitter — confirmed by reading backend/src/game/session.js's
// `quitSession` (it only `sendTo`s the *remaining* opponent,
// `room:playerLeft` then `room:closed`) and
// backend/src/matchmaking/queue.js's `tryMatch` `onEnd` callback (it
// only records `bansByPlayerId.set(...)` server-side, with no `sendTo`
// back to the quitter at all). The quitter only learns their
// `bannedUntil` the next time *any* socket for that `playerId` sends
// `queue:join` before the ban expires.
//
// So this module is not wired into `game/multiplayerMatch.ts`'s quit
// flow — there is nothing for it to react to there. Ticket #14 (the real
// "Find Match" flow) is the actual call site: it should call
// `client.on('queue:banned', (msg) => renderBanBanner(el, msg.bannedUntil))`
// and mount `el` inside `#menu-matchmaking` (see index.html), most likely
// replacing/disabling `#find-match-btn` for the ban's duration.

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bannerMarkup(): string {
  return `
    <div class="ban-banner">
      <span class="ban-banner-icon">⏳</span>
      <span class="ban-banner-text"></span>
    </div>`;
}

/** Renders a persistent "Matchmaking available in M:SS" banner into
 * `container`, live-updating once a second from `bannedUntil` (the
 * epoch-ms value delivered on a `queue:banned` message). Automatically
 * clears itself once the ban expires. Returns a `stop()` — cancels the
 * interval and clears `container` — call it on unmount, or before a
 * fresh `renderBanBanner` call if a later `queue:banned` arrives with an
 * updated `bannedUntil`. */
export function renderBanBanner(container: HTMLElement, bannedUntil: number): () => void {
  container.innerHTML = bannerMarkup();
  container.classList.remove('hidden');
  const text = container.querySelector<HTMLElement>('.ban-banner-text')!;

  let intervalId: number | null = null;

  function stop(): void {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    container.innerHTML = '';
    container.classList.add('hidden');
  }

  function tick(): void {
    const remaining = bannedUntil - Date.now();
    if (remaining <= 0) {
      stop();
      return;
    }
    text.textContent = `Matchmaking available in ${formatRemaining(remaining)}`;
  }

  tick();
  intervalId = window.setInterval(tick, 1000);
  return stop;
}
