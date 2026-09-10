import { renderThemePreview } from '../preview/themePreview';
import { THEMES } from '../data/themes';
import type { ThemeId } from '../types';

export interface PreviewFlowElements {
  overlay: HTMLElement;
  countdown: HTMLElement;
  caption: HTMLElement;
  canvas: HTMLCanvasElement;
}

const COUNTDOWN_SECONDS = 5;

function bumpCountdown(el: HTMLElement, text: string): void {
  el.textContent = text;
  el.classList.remove('tick');
  void el.offsetWidth;
  el.classList.add('tick');
}

/** Flashes a different, real-colored snippet of the chosen theme for a
 * few seconds before handing control to `onDone`. `onTick` fires once per
 * second (including the first frame) so the caller can layer in sound. */
export function runThemePreview(
  elements: PreviewFlowElements,
  themeId: ThemeId,
  onDone: () => void,
  onTick?: () => void,
): void {
  renderThemePreview(elements.canvas, themeId);
  elements.caption.textContent = `LOADING: ${THEMES[themeId].name.toUpperCase()}`;
  elements.overlay.classList.remove('hidden');

  let remaining = COUNTDOWN_SECONDS;
  bumpCountdown(elements.countdown, String(remaining));
  onTick?.();

  const timer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(timer);
      elements.overlay.classList.add('hidden');
      onDone();
      return;
    }
    bumpCountdown(elements.countdown, String(remaining));
    onTick?.();
  }, 1000);
}
