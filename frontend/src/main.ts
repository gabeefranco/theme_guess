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

const menuModal = requireEl<HTMLElement>('intro-modal');
const resultModal = requireEl<HTMLElement>('result-modal');
const themeGridEl = requireEl<HTMLElement>('theme-grid');
const startBtn = requireEl<HTMLButtonElement>('start-btn');
const enterCodeBtn = requireEl<HTMLButtonElement>('enter-code-btn');
const createRoomBtn = requireEl<HTMLButtonElement>('create-room-btn');
const findMatchBtn = requireEl<HTMLButtonElement>('find-match-btn');
const helpBtn = requireEl<HTMLButtonElement>('help-btn');
const muteBtn = requireEl<HTMLButtonElement>('mute-btn');
const themeNameBadge = requireEl<HTMLElement>('theme-name-badge');
const changeThemeBtn = requireEl<HTMLButtonElement>('change-theme-btn');

const previewElements = {
  overlay: requireEl<HTMLElement>('preview-overlay'),
  countdown: requireEl<HTMLElement>('preview-countdown'),
  caption: requireEl<HTMLElement>('preview-caption'),
  canvas: requireEl<HTMLCanvasElement>('preview-canvas'),
};

/** Top-level overlay screens the composition root switches between. At most
 * one is visible at a time; the game board underneath is always present and
 * simply gets obscured while a screen is shown. */
const screens = {
  menu: menuModal,
  result: resultModal,
} as const;

type ScreenName = keyof typeof screens;

function showView(name: ScreenName | null): void {
  for (const key of Object.keys(screens) as ScreenName[]) {
    screens[key].classList.toggle('hidden', key !== name);
  }
}

let game: ThemeGuessGame | null = null;

const themeGrid = createThemeGrid(themeGridEl, 'gruvbox', () => sound.playOpen());

// Solo is the only flow this ticket wires end-to-end. Ticket #17 will
// replace this direct "pick a theme, hit play" shortcut with a fuller solo
// config flow inside #menu-solo; keep it working in the meantime.
function playSolo(): void {
  const themeId: ThemeId = themeGrid.selected;
  showView(null);
  runThemePreview(previewElements, themeId, () => {
    if (game) game.setTheme(themeId);
    else game = new ThemeGuessGame(themeId);
    themeNameBadge.textContent = THEMES[themeId].name;
    sound.playApply();
  }, () => sound.playOpen());
}

startBtn.addEventListener('click', playSolo);

// TODO(#17/#15/#14): wire real flow
enterCodeBtn.addEventListener('click', () => console.log('[menu] enter code clicked (not implemented yet)'));
// TODO(#17/#15/#14): wire real flow
createRoomBtn.addEventListener('click', () => console.log('[menu] create room clicked (not implemented yet)'));
// TODO(#17/#15/#14): wire real flow
findMatchBtn.addEventListener('click', () => console.log('[menu] find match clicked (not implemented yet)'));

helpBtn.addEventListener('click', () => showView('menu'));
changeThemeBtn.addEventListener('click', () => showView('menu'));

muteBtn.addEventListener('click', () => {
  const muted = sound.toggleMute();
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

showView('menu');
