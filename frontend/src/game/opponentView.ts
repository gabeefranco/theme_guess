import { tokenize } from '../engine/tokenizer';
import { SNIPPETS, pickRandomSnippetIndex } from '../data/snippets';
import type { CategoryId, Token } from '../types';
import { FONT_SIZE, FONT_STACK, GUTTER, LINE_HEIGHT, PAD } from './layoutConstants';
import { drawOpponentFrame } from './renderer';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
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
 * Mirrors `ThemeGuessGame`'s canvas-ownership pattern, but far simpler:
 * no picker, no clicks, no animation loop — every redraw is a flat,
 * instant swap (see `drawOpponentFrame`).
 */
export class OpponentView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private snippetIndex: number;
  private tokens: Token[] = [];
  private lineCount = 1;
  private maxCols = 0;
  private charWidth = 0;
  private width = 0;
  private height = 0;
  private assigned = new Set<CategoryId>();

  constructor(canvasId: string, snippetIndex: number = pickRandomSnippetIndex()) {
    this.canvas = requireEl<HTMLCanvasElement>(canvasId);
    this.ctx = this.canvas.getContext('2d')!;
    this.snippetIndex = snippetIndex;
    this.build();
  }

  /** Forces a specific snippet (by stable `SNIPPETS` index) and clears
   * progress — mirrors `ThemeGuessGame.setSnippet`, used to keep both
   * players' panes on the same source file each match. */
  setSnippet(index: number): void {
    this.snippetIndex = index;
    this.assigned = new Set();
    this.build();
  }

  /** Marks one category as assigned by the opponent and redraws. Takes
   * only a `CategoryId` — never a color — so there is no code path for
   * an opponent's real chosen hex to reach this view. */
  markAssigned(categoryId: CategoryId): void {
    this.assigned.add(categoryId);
    this.draw();
  }

  /** Clears every progress signal for reuse across matches, without
   * touching the current snippet/layout. */
  reset(): void {
    this.assigned = new Set();
    this.draw();
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
    this.draw();
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

  private draw(): void {
    drawOpponentFrame({
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      charWidth: this.charWidth,
      lineCount: this.lineCount,
      tokens: this.tokens,
      assigned: this.assigned,
    }, performance.now());
  }
}
