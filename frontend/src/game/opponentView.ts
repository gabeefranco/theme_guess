import { tokenize } from '../engine/tokenizer';
import { SNIPPETS, pickRandomSnippetIndex } from '../data/snippets';
import { CATEGORY_META } from '../data/themes';
import { easeOutCubic, hexToRgb, lerpRgb } from '../engine/colorUtils';
import type { CategoryId, RGB, Token } from '../types';
import { FONT_SIZE, FONT_STACK, GUTTER, LINE_HEIGHT, PAD, TRANSITION_MS } from './layoutConstants';
import { drawOpponentFrame, OPPONENT_ASSIGNED_HEX, OPPONENT_UNASSIGNED_HEX } from './renderer';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const UNASSIGNED_RGB = hexToRgb(OPPONENT_UNASSIGNED_HEX);
const ASSIGNED_RGB = hexToRgb(OPPONENT_ASSIGNED_HEX);

/** One category's animated fill — a lerp from `from` to `to`, eased and
 * timed exactly like `ThemeGuessGame`'s own `CategoryState.currentRgb`
 * (see `layoutConstants.TRANSITION_MS`), except `to` is always either
 * `UNASSIGNED_RGB` or `ASSIGNED_RGB`: never a real opponent-chosen hex. */
interface FillState {
  current: RGB;
  from: RGB;
  to: RGB;
  start: number;
}

/**
 * Owns the "opponent progress" canvas: a read-only mirror of the shared
 * match snippet that reveals only a binary "has the opponent assigned
 * this category yet?" signal, driven by `round:progress` messages
 * (see PROTOCOL.md — that message carries a bare `CategoryId`, never a
 * color). `markAssigned` is the only way to light up a category, and it
 * only ever accepts a `CategoryId`, so a real opponent-chosen hex has no
 * path into this view by construction.
 *
 * Mirrors `ThemeGuessGame`'s canvas-ownership pattern closely: no picker,
 * no clicks, but the same perpetual `requestAnimationFrame` loop easing
 * each category's flat color in (see `FillState`), and the same
 * "mutate state, let the loop pick it up next frame" convention — none
 * of `setSnippet`/`markAssigned`/`reset` draw synchronously.
 *
 * Also owns the "opponent finished" banner: once every category has been
 * marked assigned, `#opponent-complete-banner` is shown until the next
 * `reset`/`setSnippet`.
 */
export class OpponentView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly completeBanner = requireEl<HTMLElement>('opponent-complete-banner');

  private snippetIndex: number;
  private tokens: Token[] = [];
  private lineCount = 1;
  private maxCols = 0;
  private charWidth = 0;
  private width = 0;
  private height = 0;
  private assigned = new Set<CategoryId>();
  private fills = {} as Record<CategoryId, FillState>;

  constructor(canvasId: string, snippetIndex: number = pickRandomSnippetIndex()) {
    this.canvas = requireEl<HTMLCanvasElement>(canvasId);
    this.ctx = this.canvas.getContext('2d')!;
    this.snippetIndex = snippetIndex;
    this.resetFills();
    this.build();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Forces a specific snippet (by stable `SNIPPETS` index) and clears
   * progress — mirrors `ThemeGuessGame.setSnippet`, used to keep both
   * players' panes on the same source file each match. */
  setSnippet(index: number): void {
    this.snippetIndex = index;
    this.assigned = new Set();
    this.resetFills();
    this.completeBanner.classList.add('hidden');
    this.build();
  }

  /** Marks one category as assigned by the opponent and starts its
   * fade-to-green transition. Takes only a `CategoryId` — never a
   * color — so there is no code path for an opponent's real chosen hex
   * to reach this view. Shows the "opponent finished" banner once every
   * category has been marked. Idempotent per category, so a duplicate
   * `round:progress` can't restart an in-flight fade. */
  markAssigned(categoryId: CategoryId): void {
    if (this.assigned.has(categoryId)) return;
    this.assigned.add(categoryId);

    const fill = this.fills[categoryId];
    fill.from = fill.current;
    fill.to = { ...ASSIGNED_RGB };
    fill.start = performance.now();

    if (this.assigned.size === CATEGORY_META.length) this.completeBanner.classList.remove('hidden');
  }

  /** Clears every progress signal (and the finished banner) for reuse
   * across matches, without touching the current snippet/layout. */
  reset(): void {
    this.assigned = new Set();
    this.resetFills();
    this.completeBanner.classList.add('hidden');
  }

  private resetFills(): void {
    this.fills = {} as Record<CategoryId, FillState>;
    for (const def of CATEGORY_META) {
      this.fills[def.id] = { current: { ...UNASSIGNED_RGB }, from: { ...UNASSIGNED_RGB }, to: { ...UNASSIGNED_RGB }, start: 0 };
    }
  }

  private build(): void {
    this.tokens = tokenize(SNIPPETS[this.snippetIndex]);

    this.lineCount = 1;
    this.maxCols = 0;
    let col = 0;
    for (const t of this.tokens) {
      if (t.type === 'newline') { this.lineCount++; col = 0; }
      else { col += t.text.length; this.maxCols = Math.max(this.maxCols, col); }
    }

    this.setupCanvasSize();
  }

  private setupCanvasSize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.font = `${FONT_SIZE}px ${FONT_STACK}`;
    this.charWidth = this.ctx.measureText('M').width;
    this.width = GUTTER + PAD * 2 + this.maxCols * this.charWidth;
    this.height = PAD * 2 + this.lineCount * LINE_HEIGHT;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private loop(now: number): void {
    this.tickFills(now);
    this.draw(now);
    requestAnimationFrame((t) => this.loop(t));
  }

  private tickFills(now: number): void {
    for (const def of CATEGORY_META) {
      const fill = this.fills[def.id];
      if (!fill.start) continue;
      const p = Math.min(1, (now - fill.start) / TRANSITION_MS);
      fill.current = lerpRgb(fill.from, fill.to, easeOutCubic(p));
      if (p >= 1) fill.start = 0;
    }
  }

  private draw(now: number): void {
    const currentRgb = {} as Record<CategoryId, RGB>;
    for (const def of CATEGORY_META) currentRgb[def.id] = this.fills[def.id].current;

    drawOpponentFrame({
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      charWidth: this.charWidth,
      lineCount: this.lineCount,
      tokens: this.tokens,
      currentRgb,
    }, now);
  }
}
