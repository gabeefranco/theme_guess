import { tokenize } from '../engine/tokenizer';
import { THEMES, PREVIEW_SAMPLE } from '../data/themes';
import type { ThemeId } from '../types';
import { FONT_STACK } from '../game/layoutConstants';

const FONT_SIZE = 16;
const LINE_HEIGHT = 24;
const PAD = 20;

// Draws the (different, intentionally incomplete) preview snippet fully
// colored with a theme's *real* colors — no guessing, just a flash of
// what the target theme actually looks like.
export function renderThemePreview(canvas: HTMLCanvasElement, themeId: ThemeId): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const tokens = tokenize(PREVIEW_SAMPLE);

  ctx.font = `${FONT_SIZE}px ${FONT_STACK}`;
  const charWidth = ctx.measureText('M').width;

  let lineCount = 1;
  let maxCols = 0;
  let col = 0;
  for (const t of tokens) {
    if (t.type === 'newline') { lineCount++; col = 0; }
    else { col += t.text.length; maxCols = Math.max(maxCols, col); }
  }

  const dpr = window.devicePixelRatio || 1;
  const width = PAD * 2 + maxCols * charWidth;
  const height = PAD * 2 + lineCount * LINE_HEIGHT;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const theme = THEMES[themeId];
  ctx.fillStyle = theme.colors.background;
  ctx.fillRect(0, 0, width, height);

  ctx.textBaseline = 'alphabetic';
  for (const t of tokens) {
    if (t.type === 'whitespace' || t.type === 'newline') continue;
    const x = PAD + t.col * charWidth;
    const y = PAD + t.line * LINE_HEIGHT + FONT_SIZE - 3;
    ctx.font = t.type === 'comment'
      ? `italic ${FONT_SIZE}px ${FONT_STACK}`
      : `${FONT_SIZE}px ${FONT_STACK}`;
    ctx.fillStyle = theme.colors[t.type as keyof typeof theme.colors] ?? theme.colors.punctuation;
    ctx.fillText(t.text, x, y);
  }
}
