// In-match timer HUD: a countdown mode badge + progress bar driven purely
// by the server-authoritative `endsAt` from `round:start`, plus a one-shot
// "20 seconds left" toast for `round:timeWarning`. DOM-only, no class —
// mirrors the plain-function style of `resultView.ts`. The client never
// runs independent timer logic that could drift from the server: every
// tick recomputes `endsAt - Date.now()` rather than counting its own
// elapsed time.

/** Discriminated union so a caller can't pass `endsAt` without a real
 * deadline (or omit it with one). `timeMode` doubles as the mode-badge
 * source and the progress bar's total duration (in minutes). `'none'` is
 * solo's infinite-time mode: no deadline, so no progress bar — the clock
 * counts elapsed time up from when `startCountdown` was called instead. */
export type TimerHudOptions =
  | { timeMode: 1 | 2; endsAt: number }
  | { timeMode: 'none'; endsAt?: null };

const TIME_MODE_LABEL: Record<1 | 2 | 'none', string> = {
  1: '1 MIN',
  2: '2 MIN',
  none: 'NO LIMIT',
};

const WARNING_DISMISS_MS = 4000;

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function countdownMarkup(): string {
  return `
    <div class="match-timer-hud">
      <span class="match-timer-badge"></span>
      <div class="match-timer-track"><div class="match-timer-fill"></div></div>
      <span class="match-timer-clock">00:00</span>
    </div>`;
}

function elapsedMarkup(): string {
  return `
    <div class="match-timer-hud match-timer-hud--elapsed">
      <span class="match-timer-badge"></span>
      <span class="match-timer-clock">00:00</span>
    </div>`;
}

/** Renders the mode badge + (for 1/2-minute modes) progress bar + mm:ss
 * readout into `container`, and starts driving it from `options.endsAt`
 * via requestAnimationFrame. Returns a `stop()` that cancels the animation
 * loop; call it on round end/teardown to avoid leaking the RAF handle. */
export function startCountdown(container: HTMLElement, options: TimerHudOptions): () => void {
  const isCountdown = options.timeMode !== 'none';
  container.innerHTML = isCountdown ? countdownMarkup() : elapsedMarkup();
  container.classList.remove('hidden');

  const badge = container.querySelector<HTMLElement>('.match-timer-badge')!;
  const clock = container.querySelector<HTMLElement>('.match-timer-clock')!;
  const fill = container.querySelector<HTMLElement>('.match-timer-fill');
  badge.textContent = TIME_MODE_LABEL[options.timeMode];

  const startedAt = Date.now();
  let rafId: number | null = null;

  function stop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function tick(): void {
    if (options.timeMode === 'none') {
      clock.textContent = formatClock(Date.now() - startedAt);
      rafId = requestAnimationFrame(tick);
      return;
    }

    const remaining = options.endsAt - Date.now();
    clock.textContent = formatClock(Math.max(0, remaining));
    if (fill) {
      const total = options.timeMode * 60_000;
      const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
      fill.style.width = `${pct}%`;
    }
    if (remaining <= 0) {
      stop();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  tick();
  return stop;
}

const pendingDismiss = new WeakMap<HTMLElement, number>();

/** Renders a small, auto-dismissing "20 seconds left" toast into
 * `container`. Positioned by CSS (`.match-timer-warning-toast`) to stay
 * clear of the canvas and category panel, and with `pointer-events: none`
 * so it never intercepts clicks on tokens or the color picker underneath. */
export function showTimeWarning(container: HTMLElement): void {
  const pending = pendingDismiss.get(container);
  if (pending !== undefined) window.clearTimeout(pending);

  container.innerHTML = '<div class="match-timer-warning-toast">⏰ 20 seconds left!</div>';
  container.classList.remove('hidden');

  const timeoutId = window.setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
    pendingDismiss.delete(container);
  }, WARNING_DISMISS_MS);
  pendingDismiss.set(container, timeoutId);
}
