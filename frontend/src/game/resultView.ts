import { easeOutCubic } from '../engine/colorUtils';
import { METER_BLOCKS } from './layoutConstants';
import type { MatchResultRow } from '../types';

export function barColor(sim: number): string {
  if (sim < 40) return '#ff5555';
  if (sim < 65) return '#ffa657';
  if (sim < 82) return '#ffd23f';
  return '#5fd75f';
}

export function verdictFor(score: number): string {
  if (score >= 92) return '🏆 PIXEL PERFECT!';
  if (score >= 80) return '🔥 SO CLOSE!';
  if (score >= 60) return '🌤️ GETTING WARM';
  if (score >= 40) return '🎭 BOLD REMIX';
  return '😅 NEW GAME +';
}

/** Renders one row per category comparing the player's guess against the
 * real color, each bar animating in with a staggered fade. */
export function renderBreakdown(container: HTMLElement, rows: MatchResultRow[]): void {
  container.innerHTML = '';
  rows.forEach((row, i) => {
    const el = document.createElement('div');
    el.className = 'breakdown-row';
    el.style.animationDelay = `${i * 60}ms`;
    el.innerHTML = `
      <div class="swatch-pair">
        <span style="background:${row.guess}"></span>
        <span style="background:${row.actualHex}"></span>
      </div>
      <div class="breakdown-info">
        <div class="breakdown-label">${row.icon} ${row.label}</div>
        <div class="breakdown-bar"><div class="breakdown-bar-fill"></div></div>
      </div>
      <div class="breakdown-pct">${Math.round(row.sim)}%</div>`;
    container.appendChild(el);
    requestAnimationFrame(() => {
      const fill = el.querySelector<HTMLElement>('.breakdown-bar-fill');
      if (!fill) return;
      fill.style.width = `${row.sim}%`;
      fill.style.background = barColor(row.sim);
    });
  });
}

/** Builds the pixel-block score meter and animates it, and the big
 * percentage readout, up to the final overall score together. */
export function renderScoreMeter(meterEl: HTMLElement, numberEl: HTMLElement, overall: number): void {
  meterEl.innerHTML = '';
  const litColor = barColor(overall);
  for (let i = 0; i < METER_BLOCKS; i++) {
    const b = document.createElement('span');
    b.className = 'meter-block';
    b.style.setProperty('--lit-color', litColor);
    meterEl.appendChild(b);
  }
  const blocks = meterEl.children;
  const targetLit = Math.round((overall / 100) * METER_BLOCKS);

  const start = performance.now();
  const duration = 1100;
  const animate = (t: number) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = easeOutCubic(p);
    numberEl.textContent = `${Math.round(overall * eased)}%`;
    const lit = Math.round(targetLit * eased);
    for (let i = 0; i < blocks.length; i++) blocks[i].classList.toggle('lit', i < lit);
    if (p < 1) requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
