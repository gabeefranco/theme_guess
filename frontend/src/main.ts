import './style.css';
import { ThemeGuessGame } from './game/ThemeGuessGame';
import { THEMES } from './data/themes';
import { sound } from './engine/sound';
import { createThemeGrid } from './ui/themeGrid';
import { runThemePreview } from './ui/previewFlow';
import type { ThemeId } from './types';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const introModal = requireEl<HTMLElement>('intro-modal');
const themeGridEl = requireEl<HTMLElement>('theme-grid');
const startBtn = requireEl<HTMLButtonElement>('start-btn');
const helpBtn = requireEl<HTMLButtonElement>('help-btn');
const muteBtn = requireEl<HTMLButtonElement>('mute-btn');
const themeNameBadge = requireEl<HTMLElement>('theme-name-badge');
const changeThemeBtn = requireEl<HTMLButtonElement>('change-theme-btn');
const resultModal = requireEl<HTMLElement>('result-modal');

const previewElements = {
  overlay: requireEl<HTMLElement>('preview-overlay'),
  countdown: requireEl<HTMLElement>('preview-countdown'),
  caption: requireEl<HTMLElement>('preview-caption'),
  canvas: requireEl<HTMLCanvasElement>('preview-canvas'),
};

let game: ThemeGuessGame | null = null;

const themeGrid = createThemeGrid(themeGridEl, 'gruvbox', () => sound.playOpen());

function startWithSelectedTheme(): void {
  const themeId: ThemeId = themeGrid.selected;
  introModal.classList.add('hidden');
  runThemePreview(previewElements, themeId, () => {
    if (game) game.setTheme(themeId);
    else game = new ThemeGuessGame(themeId);
    themeNameBadge.textContent = THEMES[themeId].name;
    sound.playApply();
  }, () => sound.playOpen());
}

startBtn.addEventListener('click', startWithSelectedTheme);
helpBtn.addEventListener('click', () => introModal.classList.remove('hidden'));
changeThemeBtn.addEventListener('click', () => {
  resultModal.classList.add('hidden');
  introModal.classList.remove('hidden');
});

muteBtn.addEventListener('click', () => {
  const muted = sound.toggleMute();
  muteBtn.textContent = muted ? '🔇' : '🔊';
});
