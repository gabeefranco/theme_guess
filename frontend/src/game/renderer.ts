import { rgbToHex } from '../engine/colorUtils';
import type { ParticleSystem } from '../engine/particles';
import type { CategoryId, CategoryStateMap, RGB, Token } from '../types';
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

/** Flat color used to signal "opponent has assigned this category" in
 * the opponent-progress pane. Never a real chosen hex — the opponent's
 * actual color is never transmitted or known here (see PROTOCOL.md
 * `round:progress`), so this is the only color this view can ever show
 * for a picked category. */
export const OPPONENT_ASSIGNED_HEX = '#5fd75f';
/** Flat grey used for categories the opponent hasn't picked yet. */
export const OPPONENT_UNASSIGNED_HEX = '#3a3a52';

/** Everything one frame of the opponent-progress canvas needs. Deliberately
 * narrower than `RenderState`: no gradient pulse or particles, and only
 * ever a lerp between the two flat opponent-progress colors above — but
 * (unlike a plain binary signal) `currentRgb` carries `OpponentView`'s
 * in-flight per-category animation state, one entry per `CategoryId`
 * including 'background'. Kept DOM-free like `drawFrame`. */
export interface OpponentRenderState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  charWidth: number;
  lineCount: number;
  tokens: Token[];
  currentRgb: Record<CategoryId, RGB>;
}

/** Draws the same snippet as `drawFrame`, but every category is a flat
 * `OPPONENT_UNASSIGNED_HEX`-to-`OPPONENT_ASSIGNED_HEX` fill driven by
 * `state.currentRgb` — `OpponentView` animates that lerp the same way
 * `ThemeGuessGame` animates the player's own canvas (see
 * `layoutConstants.TRANSITION_MS`), just always between those two flat
 * colors instead of an arbitrary chosen hex. */
export function drawOpponentFrame(state: OpponentRenderState, _now: number): void {
  const { ctx } = state;
  ctx.clearRect(0, 0, state.width, state.height);

  ctx.fillStyle = rgbToHex(state.currentRgb.background);
  ctx.fillRect(0, 0, state.width, state.height);

  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.fillRect(0, 0, GUTTER, state.height);

  ctx.fillStyle = '#665c54';
  ctx.font = `${FONT_SIZE - 3}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  for (let l = 0; l < state.lineCount; l++) {
    ctx.fillText(String(l + 1).padStart(2, ' '), 8, PAD + l * LINE_HEIGHT + FONT_SIZE - 4);
  }

  // Stroked outline so foreground text stays legible even when a token's
  // category and the background happen to share the same flat color.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10,10,18,.65)';
  ctx.lineJoin = 'round';
  for (const t of state.tokens) {
    if (t.type === 'whitespace' || t.type === 'newline') continue;
    const cat = t.type as CategoryId;
    const x = GUTTER + PAD + t.col * state.charWidth;
    const y = PAD + t.line * LINE_HEIGHT + FONT_SIZE - 4;
    ctx.font = t.type === 'comment'
      ? `italic ${FONT_SIZE}px ${FONT_STACK}`
      : `${FONT_SIZE}px ${FONT_STACK}`;
    ctx.fillStyle = rgbToHex(state.currentRgb[cat]);
    ctx.strokeText(t.text, x, y);
    ctx.fillText(t.text, x, y);
  }
}
