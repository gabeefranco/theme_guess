import { tokenize } from '../engine/tokenizer';
import { CATEGORY_META, THEMES } from '../data/themes';
import { SNIPPETS, pickRandomSnippetIndex } from '../data/snippets';
import { easeOutCubic, hexToRgb, isValidHex, lerpRgb, rgbToHex } from '../engine/colorUtils';
import { ParticleSystem } from '../engine/particles';
import { sound } from '../engine/sound';
import type { CategoryId, CategoryStateMap, RGB, ThemeId, Token } from '../types';
import { FONT_SIZE, FONT_STACK, GUTTER, LINE_HEIGHT, PAD, TRANSITION_MS, UNSET_BG_RGB, UNSET_FG_RGB } from './layoutConstants';
import { drawFrame } from './renderer';
import { computeMatchResult } from './scoring';
import { renderCategoryPanel, setActiveCard, markCategoryAssigned, getCardRect } from './panelView';
import { renderBreakdown, renderScoreMeter, verdictFor } from './resultView';

type CompareMode = 'yours' | 'original';

/** Grabs a required element by id, throwing early with a useful message
 * instead of failing later on a null dereference. */
function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

export class ThemeGuessGame {
  private readonly canvas = requireEl<HTMLCanvasElement>('code-canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly panel = requireEl<HTMLElement>('category-panel');
  private readonly popover = requireEl<HTMLElement>('picker-popover');
  private readonly popoverLabel = requireEl<HTMLElement>('popover-label');
  private readonly popoverColor = requireEl<HTMLInputElement>('popover-color');
  private readonly popoverHex = requireEl<HTMLInputElement>('popover-hex');
  private readonly progressFill = requireEl<HTMLElement>('progress-fill');
  private readonly progressLabel = requireEl<HTMLElement>('progress-label');
  private readonly revealBtn = requireEl<HTMLButtonElement>('reveal-btn');
  private readonly resetBtn = requireEl<HTMLButtonElement>('reset-btn');
  private readonly resultModal = requireEl<HTMLElement>('result-modal');
  private readonly scoreNumber = requireEl<HTMLElement>('score-number');
  private readonly scoreMeter = requireEl<HTMLElement>('score-meter');
  private readonly scoreVerdict = requireEl<HTMLElement>('score-verdict');
  private readonly breakdownEl = requireEl<HTMLElement>('score-breakdown');
  private readonly compareToggle = requireEl<HTMLElement>('compare-toggle');
  private readonly closeResultBtn = requireEl<HTMLButtonElement>('close-result-btn');
  private readonly playAgainBtn = requireEl<HTMLButtonElement>('play-again-btn');

  private readonly fx = new ParticleSystem();

  private themeId: ThemeId;
  private snippetIndex: number;
  private activeCategory: CategoryId | null = null;
  private compareMode: CompareMode = 'yours';
  private lastTime = performance.now();
  private pickerOrigin: RGB | null = null;

  private tokens: Token[] = [];
  private lineCount = 1;
  private maxCols = 0;
  private charWidth = 0;
  private width = 0;
  private height = 0;
  private categories!: CategoryStateMap;

  /** `onCategoryAssigned`, when provided, fires at the end of every
   * `applyColor` with the category and hex just assigned — multiplayer
   * uses it to relay a bare `round:progress` and to track the local
   * player's running color map for `round:submit`, without this class
   * needing to know anything about the network. */
  constructor(
    themeId: ThemeId,
    snippetIndex: number = pickRandomSnippetIndex(),
    private readonly onCategoryAssigned?: (id: CategoryId, hex: string) => void,
  ) {
    this.themeId = themeId;
    this.snippetIndex = snippetIndex;
    this.build();
    this.bindEvents();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- setup ----------

  private build(): void {
    this.tokens = tokenize(SNIPPETS[this.snippetIndex]);

    this.lineCount = 1;
    this.maxCols = 0;
    let col = 0;
    for (const t of this.tokens) {
      if (t.type === 'newline') { this.lineCount++; col = 0; }
      else { col += t.text.length; this.maxCols = Math.max(this.maxCols, col); }
    }

    const counts: Partial<Record<CategoryId, number>> = {};
    for (const t of this.tokens) {
      if (t.type === 'whitespace' || t.type === 'newline' || t.type === 'identifier') continue;
      counts[t.type] = (counts[t.type] ?? 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));

    const theme = THEMES[this.themeId];
    const categories = {} as CategoryStateMap;
    for (const def of CATEGORY_META) {
      const count = counts[def.id] ?? 0;
      const unset = def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB;
      categories[def.id] = {
        ...def,
        actualHex: theme.colors[def.id],
        weight: def.id === 'background' ? maxCount : Math.max(count, 3),
        count,
        assignedHex: null,
        currentRgb: { ...unset },
        fromRgb: { ...unset },
        toRgb: { ...unset },
        transitionStart: 0,
        pulsePhase: Math.random() * Math.PI * 2,
      };
    }
    this.categories = categories;

    this.setupCanvasSize();
    this.renderPanel();
    this.updateProgress();
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

  private renderPanel(): void {
    renderCategoryPanel(this.panel, this.categories, (id, card) => {
      this.setActiveCategory(id);
      this.openPicker(id, card.getBoundingClientRect());
    });
  }

  // ---------- theme switching ----------

  setTheme(themeId: ThemeId): void {
    this.themeId = themeId;
    const theme = THEMES[themeId];
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      cat.actualHex = theme.colors[def.id];
      cat.assignedHex = null;
      const unset = def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB;
      cat.currentRgb = { ...unset };
      cat.fromRgb = { ...unset };
      cat.toRgb = { ...unset };
      cat.transitionStart = 0;
    }
    this.compareMode = 'yours';
    this.activeCategory = null;
    this.popover.classList.add('hidden');
    this.resultModal.classList.add('hidden');
    this.renderPanel();
    this.updateProgress();
    this.fx.clear();
  }

  /** Forces a specific snippet (by stable `SNIPPETS` index) and rebuilds
   * the round around it — used by multiplayer to keep both players on
   * the same source file instead of each picking their own at random. */
  setSnippet(index: number): void {
    this.snippetIndex = index;
    this.build();
    this.activeCategory = null;
    this.popover.classList.add('hidden');
    this.resultModal.classList.add('hidden');
    this.fx.clear();
  }

  // ---------- events ----------

  private bindEvents(): void {
    this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.onCanvasHover(e));

    this.popoverColor.addEventListener('input', () => this.onPickerLiveInput(this.popoverColor.value));
    this.popoverHex.addEventListener('input', () => {
      let v = this.popoverHex.value.trim();
      if (!v.startsWith('#')) v = `#${v}`;
      if (isValidHex(v)) {
        this.popoverColor.value = v.length === 4
          ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
          : v;
        this.onPickerLiveInput(this.popoverColor.value);
      }
    });
    requireEl<HTMLButtonElement>('popover-apply').addEventListener('click', () => this.confirmPicker());
    requireEl<HTMLButtonElement>('popover-cancel').addEventListener('click', () => this.closePicker(true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.popover.classList.contains('hidden')) this.closePicker(true);
    });
    document.addEventListener('click', (e) => {
      if (this.popover.classList.contains('hidden')) return;
      const target = e.target as HTMLElement;
      if (this.popover.contains(target) || target === this.canvas || target.closest('.cat-card')) return;
      this.closePicker(true);
    });

    this.revealBtn.addEventListener('click', () => this.reveal());
    this.resetBtn.addEventListener('click', () => this.resetColors());

    this.compareToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.toggle-btn');
      if (!btn?.dataset.mode) return;
      this.setCompareMode(btn.dataset.mode as CompareMode);
    });
    this.closeResultBtn.addEventListener('click', () => this.resultModal.classList.add('hidden'));
    this.playAgainBtn.addEventListener('click', () => {
      this.resultModal.classList.add('hidden');
      this.resetColors();
    });
  }

  private onCanvasHover(e: MouseEvent): void {
    const { x, y } = this.toCanvasCoords(e);
    const token = this.tokenAt(x, y);
    this.canvas.style.cursor = token ? 'pointer' : 'default';
  }

  private onCanvasClick(e: MouseEvent): void {
    const { x, y } = this.toCanvasCoords(e);
    const token = this.tokenAt(x, y);
    this.fx.spawnRipple(x, y, token ? rgbToHex(this.categories[token.type as CategoryId].currentRgb) : '#a89984');
    if (!token) return;
    sound.playOpen();
    const id = token.type as CategoryId;
    this.setActiveCategory(id);
    this.openPicker(id, getCardRect(this.panel, id));
  }

  private toCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  private tokenAt(px: number, py: number): Token | null {
    const col = Math.floor((px - GUTTER - PAD) / this.charWidth);
    const line = Math.floor((py - PAD) / LINE_HEIGHT);
    if (line < 0 || col < 0) return null;
    for (const t of this.tokens) {
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      if (t.line === line && col >= t.col && col < t.col + t.text.length) return t;
    }
    return null;
  }

  // ---------- category / picker ----------

  private setActiveCategory(id: CategoryId): void {
    this.activeCategory = id;
    setActiveCard(this.panel, id);
  }

  private openPicker(id: CategoryId, anchorRect: DOMRect): void {
    const cat = this.categories[id];
    this.pickerOrigin = { ...cat.currentRgb };
    const startHex = cat.assignedHex || rgbToHex(cat.currentRgb);
    this.popoverLabel.textContent = `${cat.icon} ${cat.label}`;
    this.popoverColor.value = startHex;
    this.popoverHex.value = startHex;
    this.popover.classList.remove('hidden');

    const pw = 220;
    const ph = 160;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 10;
    if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
    if (top + ph > window.innerHeight - 10) top = anchorRect.top - ph - 10;
    this.popover.style.left = `${Math.max(10, left)}px`;
    this.popover.style.top = `${Math.max(10, top)}px`;
    this.popoverHex.focus();
    this.popoverHex.select();
  }

  private onPickerLiveInput(hex: string): void {
    if (!this.activeCategory) return;
    this.popoverHex.value = hex;
    const cat = this.categories[this.activeCategory];
    cat.currentRgb = hexToRgb(hex);
    cat.transitionStart = 0;
  }

  private confirmPicker(): void {
    if (!this.activeCategory) return;
    this.applyColor(this.activeCategory, this.popoverColor.value);
    this.closePicker(false);
  }

  private closePicker(cancelled: boolean): void {
    if (cancelled && this.activeCategory) {
      const cat = this.categories[this.activeCategory];
      cat.currentRgb = cat.assignedHex ? hexToRgb(cat.assignedHex) : this.pickerOrigin ?? cat.currentRgb;
    }
    this.popover.classList.add('hidden');
    setActiveCard(this.panel, null);
    this.activeCategory = null;
  }

  private applyColor(id: CategoryId, hex: string): void {
    const cat = this.categories[id];
    cat.assignedHex = hex;
    cat.fromRgb = { ...cat.currentRgb };
    cat.toRgb = hexToRgb(hex);
    cat.transitionStart = this.lastTime;

    markCategoryAssigned(this.panel, id, hex);

    for (const c of this.tokenCentersFor(id, 10)) this.fx.spawnBurst(c.x, c.y, hex, 10);
    sound.playApply();
    this.updateProgress();
    this.onCategoryAssigned?.(id, hex);
  }

  private tokenCentersFor(id: CategoryId, max: number): { x: number; y: number }[] {
    const matches = this.tokens.filter((t) => t.type === id);
    const sample: { x: number; y: number }[] = [];
    const step = Math.max(1, Math.floor(matches.length / max));
    for (let i = 0; i < matches.length && sample.length < max; i += step) {
      const t = matches[i];
      sample.push({
        x: GUTTER + PAD + (t.col + t.text.length / 2) * this.charWidth,
        y: PAD + t.line * LINE_HEIGHT + LINE_HEIGHT / 2,
      });
    }
    return sample;
  }

  private updateProgress(): void {
    const total = CATEGORY_META.length;
    const done = CATEGORY_META.filter((d) => this.categories[d.id].assignedHex).length;
    this.progressFill.style.width = `${(done / total) * 100}%`;
    this.progressLabel.textContent = `${done} / ${total} TOKEN KINDS THEMED`;
    this.revealBtn.disabled = done < total;
  }

  private resetColors(): void {
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      cat.assignedHex = null;
      cat.fromRgb = { ...cat.currentRgb };
      cat.toRgb = { ...(def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB) };
      cat.transitionStart = this.lastTime;
    }
    this.compareMode = 'yours';
    this.renderPanel();
    this.updateProgress();
    this.fx.clear();
  }

  private setCompareMode(mode: CompareMode): void {
    if (mode === this.compareMode) return;
    this.compareMode = mode;
    for (const btn of Array.from(this.compareToggle.children)) {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    }
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      const target = mode === 'original' ? cat.actualHex : cat.assignedHex;
      if (!target) continue;
      cat.fromRgb = { ...cat.currentRgb };
      cat.toRgb = hexToRgb(target);
      cat.transitionStart = this.lastTime;
    }
  }

  // ---------- scoring / reveal ----------

  private reveal(): void {
    const { overall, rows } = computeMatchResult(this.categories);

    renderBreakdown(this.breakdownEl, rows);
    renderScoreMeter(this.scoreMeter, this.scoreNumber, overall);
    this.scoreVerdict.textContent = verdictFor(overall);

    this.resultModal.classList.remove('hidden');
    sound.playReveal(overall);
    if (overall >= 75) this.fx.spawnConfetti(160, this.width);
  }

  // ---------- render loop ----------

  private loop(t: number): void {
    const dt = t - this.lastTime;
    this.lastTime = t;
    this.tickTransitions(t);
    this.fx.update(dt);
    this.draw(t);
    requestAnimationFrame((next) => this.loop(next));
  }

  private tickTransitions(now: number): void {
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      if (!cat.transitionStart) continue;
      const p = Math.min(1, (now - cat.transitionStart) / TRANSITION_MS);
      cat.currentRgb = lerpRgb(cat.fromRgb, cat.toRgb, easeOutCubic(p));
      if (p >= 1) cat.transitionStart = 0;
    }
  }

  private draw(now: number): void {
    drawFrame({
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      charWidth: this.charWidth,
      lineCount: this.lineCount,
      tokens: this.tokens,
      categories: this.categories,
      activeCategory: this.activeCategory,
      particles: this.fx,
    }, now);
  }
}
