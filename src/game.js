import { tokenize } from './tokenizer.js';
import { CATEGORY_META, THEMES, CODE_SAMPLE } from './theme.js';
import { hexToRgb, rgbToHex, lerpRgb, easeOutCubic, isValidHex, similarityFromHex } from './colorUtils.js';
import { ParticleSystem } from './particles.js';
import { sound } from './sound.js';

const FONT_SIZE = 17;
const LINE_HEIGHT = 26;
const GUTTER = 46;
const PAD = 24;
const UNSET_BG_RGB = { r: 48, g: 44, b: 42 };
const UNSET_FG_RGB = { r: 168, g: 153, b: 132 };
const TRANSITION_MS = 550;
const METER_BLOCKS = 20;

function barColor(sim) {
  if (sim < 40) return '#ff5555';
  if (sim < 65) return '#ffa657';
  if (sim < 82) return '#ffd23f';
  return '#5fd75f';
}

function verdictFor(score) {
  if (score >= 92) return '🏆 PIXEL PERFECT!';
  if (score >= 80) return '🔥 SO CLOSE!';
  if (score >= 60) return '🌤️ GETTING WARM';
  if (score >= 40) return '🎭 BOLD REMIX';
  return '😅 NEW GAME +';
}

export class ThemeGuessGame {
  constructor(themeId) {
    this.canvas = document.getElementById('code-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = document.getElementById('category-panel');
    this.popover = document.getElementById('picker-popover');
    this.popoverLabel = document.getElementById('popover-label');
    this.popoverColor = document.getElementById('popover-color');
    this.popoverHex = document.getElementById('popover-hex');
    this.progressFill = document.getElementById('progress-fill');
    this.progressLabel = document.getElementById('progress-label');
    this.revealBtn = document.getElementById('reveal-btn');
    this.resetBtn = document.getElementById('reset-btn');
    this.resultModal = document.getElementById('result-modal');
    this.scoreNumber = document.getElementById('score-number');
    this.scoreMeter = document.getElementById('score-meter');
    this.scoreVerdict = document.getElementById('score-verdict');
    this.breakdownEl = document.getElementById('score-breakdown');
    this.compareToggle = document.getElementById('compare-toggle');
    this.closeResultBtn = document.getElementById('close-result-btn');
    this.playAgainBtn = document.getElementById('play-again-btn');

    this.themeId = themeId;
    this.fx = new ParticleSystem();
    this.activeCategory = null;
    this.compareMode = 'yours';
    this.lastTime = performance.now();

    this.build();
    this.bindEvents();
    requestAnimationFrame(this.loop.bind(this));
  }

  // ---------- setup ----------

  build() {
    this.tokens = tokenize(CODE_SAMPLE);

    this.lineCount = 1;
    this.maxCols = 0;
    let col = 0;
    for (const t of this.tokens) {
      if (t.type === 'newline') { this.lineCount++; col = 0; }
      else { col += t.text.length; this.maxCols = Math.max(this.maxCols, col); }
    }

    const counts = {};
    for (const t of this.tokens) {
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      counts[t.type] = (counts[t.type] || 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));

    const theme = THEMES[this.themeId];
    this.categories = {};
    for (const def of CATEGORY_META) {
      const count = counts[def.id] || 0;
      const unset = def.id === 'background' ? UNSET_BG_RGB : UNSET_FG_RGB;
      this.categories[def.id] = {
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

    this.setupCanvasSize();
    this.renderPanel();
    this.updateProgress();
  }

  setupCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.font = `${FONT_SIZE}px ${this.fontStack()}`;
    this.charWidth = this.ctx.measureText('M').width;
    this.width = GUTTER + PAD * 2 + this.maxCols * this.charWidth;
    this.height = PAD * 2 + this.lineCount * LINE_HEIGHT;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  fontStack() {
    return "'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Consolas,monospace";
  }

  renderPanel() {
    this.panel.innerHTML = '';
    for (const def of CATEGORY_META) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cat-card';
      card.dataset.id = def.id;
      card.innerHTML = `
        <span class="cat-swatch" data-swatch></span>
        <span class="cat-info">
          <span class="cat-label">${def.icon} ${def.label}</span>
          <span class="cat-count">${this.categories[def.id].count || '1'} token${this.categories[def.id].count === 1 ? '' : 's'}</span>
        </span>`;
      card.addEventListener('click', () => {
        this.setActiveCategory(def.id);
        this.openPicker(def.id, card.getBoundingClientRect());
      });
      this.panel.appendChild(card);
    }
  }

  // ---------- theme switching ----------

  setTheme(themeId) {
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

  // ---------- events ----------

  bindEvents() {
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
    document.getElementById('popover-apply').addEventListener('click', () => this.confirmPicker());
    document.getElementById('popover-cancel').addEventListener('click', () => this.closePicker(true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.popover.classList.contains('hidden')) this.closePicker(true);
    });
    document.addEventListener('click', (e) => {
      if (this.popover.classList.contains('hidden')) return;
      if (this.popover.contains(e.target) || e.target === this.canvas || e.target.closest('.cat-card')) return;
      this.closePicker(true);
    });

    this.revealBtn.addEventListener('click', () => this.reveal());
    this.resetBtn.addEventListener('click', () => this.resetColors());

    this.compareToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      this.setCompareMode(btn.dataset.mode);
    });
    this.closeResultBtn.addEventListener('click', () => this.resultModal.classList.add('hidden'));
    this.playAgainBtn.addEventListener('click', () => {
      this.resultModal.classList.add('hidden');
      this.resetColors();
    });
  }

  onCanvasHover(e) {
    const { x, y } = this.toCanvasCoords(e);
    const token = this.tokenAt(x, y);
    this.canvas.style.cursor = token ? 'pointer' : 'default';
  }

  onCanvasClick(e) {
    const { x, y } = this.toCanvasCoords(e);
    const token = this.tokenAt(x, y);
    this.fx.spawnRipple(x, y, token ? rgbToHex(this.categories[token.type].currentRgb) : '#a89984');
    if (!token) return;
    sound.playOpen();
    this.setActiveCategory(token.type);
    const card = this.panel.querySelector(`[data-id="${token.type}"]`);
    this.openPicker(token.type, card.getBoundingClientRect());
  }

  toCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  tokenAt(px, py) {
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

  setActiveCategory(id) {
    this.activeCategory = id;
    for (const card of this.panel.children) card.classList.toggle('active', card.dataset.id === id);
  }

  openPicker(id, anchorRect) {
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

  onPickerLiveInput(hex) {
    if (!this.activeCategory) return;
    this.popoverHex.value = hex;
    const cat = this.categories[this.activeCategory];
    cat.currentRgb = hexToRgb(hex);
    cat.transitionStart = 0;
  }

  confirmPicker() {
    if (!this.activeCategory) return;
    const hex = this.popoverColor.value;
    this.applyColor(this.activeCategory, hex);
    this.closePicker(false);
  }

  closePicker(cancelled) {
    if (cancelled && this.activeCategory) {
      const cat = this.categories[this.activeCategory];
      cat.currentRgb = cat.assignedHex ? hexToRgb(cat.assignedHex) : this.pickerOrigin;
    }
    this.popover.classList.add('hidden');
    for (const card of this.panel.children) card.classList.remove('active');
    this.activeCategory = null;
  }

  applyColor(id, hex) {
    const cat = this.categories[id];
    cat.assignedHex = hex;
    cat.fromRgb = { ...cat.currentRgb };
    cat.toRgb = hexToRgb(hex);
    cat.transitionStart = this.lastTime;

    const card = this.panel.querySelector(`[data-id="${id}"]`);
    const swatch = card.querySelector('[data-swatch]');
    swatch.style.background = hex;
    swatch.classList.remove('pop');
    void swatch.offsetWidth;
    swatch.classList.add('pop');
    card.classList.add('assigned');

    const centers = this.tokenCentersFor(id, 10);
    for (const c of centers) this.fx.spawnBurst(c.x, c.y, hex, 10);
    sound.playApply();
    this.updateProgress();
  }

  tokenCentersFor(id, max) {
    const matches = this.tokens.filter((t) => t.type === id);
    const sample = [];
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

  updateProgress() {
    const total = CATEGORY_META.length;
    const done = CATEGORY_META.filter((d) => this.categories[d.id].assignedHex).length;
    this.progressFill.style.width = `${(done / total) * 100}%`;
    this.progressLabel.textContent = `${done} / ${total} TOKEN KINDS THEMED`;
    this.revealBtn.disabled = done < total;
  }

  resetColors() {
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

  setCompareMode(mode) {
    if (mode === this.compareMode) return;
    this.compareMode = mode;
    for (const btn of this.compareToggle.children) btn.classList.toggle('active', btn.dataset.mode === mode);
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      const target = mode === 'original' ? cat.actualHex : cat.assignedHex;
      cat.fromRgb = { ...cat.currentRgb };
      cat.toRgb = hexToRgb(target);
      cat.transitionStart = this.lastTime;
    }
  }

  // ---------- scoring / reveal ----------

  reveal() {
    let totalWeight = 0;
    let weightedSum = 0;
    const rows = [];
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      const sim = similarityFromHex(cat.assignedHex, cat.actualHex);
      totalWeight += cat.weight;
      weightedSum += sim * cat.weight;
      rows.push({ ...def, guess: cat.assignedHex, actualHex: cat.actualHex, sim });
    }
    const overall = Math.round(weightedSum / totalWeight);

    this.renderResult(overall, rows);
    this.resultModal.classList.remove('hidden');
    sound.playReveal(overall);
    if (overall >= 75) this.fx.spawnConfetti(160, this.width);
  }

  renderResult(overall, rows) {
    this.breakdownEl.innerHTML = '';
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
      this.breakdownEl.appendChild(el);
      requestAnimationFrame(() => {
        el.querySelector('.breakdown-bar-fill').style.width = `${row.sim}%`;
        el.querySelector('.breakdown-bar-fill').style.background = barColor(row.sim);
      });
    });

    this.scoreVerdict.textContent = verdictFor(overall);

    this.scoreMeter.innerHTML = '';
    const litColor = barColor(overall);
    for (let i = 0; i < METER_BLOCKS; i++) {
      const b = document.createElement('span');
      b.className = 'meter-block';
      b.style.setProperty('--lit-color', litColor);
      this.scoreMeter.appendChild(b);
    }
    const blocks = this.scoreMeter.children;
    const targetLit = Math.round((overall / 100) * METER_BLOCKS);

    const start = performance.now();
    const duration = 1100;
    const animate = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = easeOutCubic(p);
      const val = Math.round(overall * eased);
      this.scoreNumber.textContent = `${val}%`;
      const lit = Math.round(targetLit * eased);
      for (let i = 0; i < blocks.length; i++) blocks[i].classList.toggle('lit', i < lit);
      if (p < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  // ---------- render loop ----------

  loop(t) {
    const dt = t - this.lastTime;
    this.lastTime = t;
    this.tickTransitions(t);
    this.fx.update(dt);
    this.draw(t);
    requestAnimationFrame(this.loop.bind(this));
  }

  tickTransitions(now) {
    for (const def of CATEGORY_META) {
      const cat = this.categories[def.id];
      if (!cat.transitionStart) continue;
      const p = Math.min(1, (now - cat.transitionStart) / TRANSITION_MS);
      cat.currentRgb = lerpRgb(cat.fromRgb, cat.toRgb, easeOutCubic(p));
      if (p >= 1) cat.transitionStart = 0;
    }
  }

  draw(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const bg = this.categories.background;
    ctx.fillStyle = rgbToHex(bg.currentRgb);
    ctx.globalAlpha = bg.assignedHex ? 1 : 0.85 + 0.1 * Math.sin(now / 500 + bg.pulsePhase);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fillRect(0, 0, GUTTER, this.height);

    if (this.activeCategory) {
      const glowAlpha = 0.16 + 0.12 * Math.sin(now / 220);
      ctx.fillStyle = `rgba(255,255,255,${glowAlpha})`;
      for (const t of this.tokens) {
        if (t.type !== this.activeCategory) continue;
        const x = GUTTER + PAD + t.col * this.charWidth;
        const yTop = PAD + t.line * LINE_HEIGHT;
        ctx.fillRect(x - 3, yTop + 1, t.text.length * this.charWidth + 6, LINE_HEIGHT - 2);
      }
    }

    ctx.fillStyle = '#665c54';
    ctx.font = `${FONT_SIZE - 3}px ${this.fontStack()}`;
    ctx.textBaseline = 'alphabetic';
    for (let l = 0; l < this.lineCount; l++) {
      ctx.fillText(String(l + 1).padStart(2, ' '), 8, PAD + l * LINE_HEIGHT + FONT_SIZE - 4);
    }

    for (const t of this.tokens) {
      if (t.type === 'whitespace' || t.type === 'newline') continue;
      const cat = this.categories[t.type];
      const x = GUTTER + PAD + t.col * this.charWidth;
      const y = PAD + t.line * LINE_HEIGHT + FONT_SIZE - 4;
      ctx.font = t.type === 'comment'
        ? `italic ${FONT_SIZE}px ${this.fontStack()}`
        : `${FONT_SIZE}px ${this.fontStack()}`;
      ctx.fillStyle = rgbToHex(cat.currentRgb);
      ctx.globalAlpha = cat.assignedHex ? 1 : 0.5 + 0.25 * Math.sin(now / 450 + cat.pulsePhase);
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;

    this.fx.draw(ctx);
  }
}
