import { rgbToHex } from '../engine/colorUtils';
import type { ParticleSystem } from '../engine/particles';
import type { CategoryId, CategoryStateMap, Token } from '../types';
import { FONT_SIZE, FONT_STACK, GUTTER, LINE_HEIGHT, PAD } from './layoutConstants';

/** Everything one frame of the code canvas needs to draw itself. Kept
 * separate from `ThemeGuessGame` so rendering has no DOM/event concerns. */
export interface RenderState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  charWidth: number;
  lineCount: number;
  tokens: Token[];
  categories: CategoryStateMap;
  activeCategory: CategoryId | null;
  particles: ParticleSystem;
}

export function drawFrame(state: RenderState, now: number): void {
  const { ctx } = state;
  ctx.clearRect(0, 0, state.width, state.height);

  const bg = state.categories.background;
  ctx.fillStyle = rgbToHex(bg.currentRgb);
  ctx.globalAlpha = bg.assignedHex ? 1 : 0.85 + 0.1 * Math.sin(now / 500 + bg.pulsePhase);
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.fillRect(0, 0, GUTTER, state.height);

  if (state.activeCategory) {
    const glowAlpha = 0.16 + 0.12 * Math.sin(now / 220);
    ctx.fillStyle = `rgba(255,255,255,${glowAlpha})`;
    for (const t of state.tokens) {
      if (t.type !== state.activeCategory) continue;
      const x = GUTTER + PAD + t.col * state.charWidth;
      const yTop = PAD + t.line * LINE_HEIGHT;
      ctx.fillRect(x - 3, yTop + 1, t.text.length * state.charWidth + 6, LINE_HEIGHT - 2);
    }
  }

  ctx.fillStyle = '#665c54';
  ctx.font = `${FONT_SIZE - 3}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  for (let l = 0; l < state.lineCount; l++) {
    ctx.fillText(String(l + 1).padStart(2, ' '), 8, PAD + l * LINE_HEIGHT + FONT_SIZE - 4);
  }

  for (const t of state.tokens) {
    if (t.type === 'whitespace' || t.type === 'newline') continue;
    const cat = state.categories[t.type as CategoryId];
    const x = GUTTER + PAD + t.col * state.charWidth;
    const y = PAD + t.line * LINE_HEIGHT + FONT_SIZE - 4;
    ctx.font = t.type === 'comment'
      ? `italic ${FONT_SIZE}px ${FONT_STACK}`
      : `${FONT_SIZE}px ${FONT_STACK}`;
    ctx.fillStyle = rgbToHex(cat.currentRgb);
    ctx.globalAlpha = cat.assignedHex ? 1 : 0.5 + 0.25 * Math.sin(now / 450 + cat.pulsePhase);
    ctx.fillText(t.text, x, y);
  }
  ctx.globalAlpha = 1;

  state.particles.draw(ctx);
}
