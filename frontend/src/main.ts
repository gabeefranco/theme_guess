import './style.css';
import { ThemeGuessGame } from './game/ThemeGuessGame';
import { THEMES } from './data/themes';
import { sound } from './engine/sound';
import { createThemeGrid } from './ui/themeGrid';
import { runThemePreview } from './ui/previewFlow';
import { createSoloConfigFlow } from './ui/soloConfigFlow';
import { createMatchmakingFlow } from './ui/matchmakingFlow';
import { client } from './net/client';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const menuModal = requireEl<HTMLElement>('intro-modal');
const resultModal = requireEl<HTMLElement>('result-modal');
const themeGridEl = requireEl<HTMLElement>('theme-grid');
const menuSoloSection = requireEl<HTMLElement>('menu-solo');
const soloThemePickerWrap = requireEl<HTMLElement>('solo-theme-picker');
const soloBotDifficultyWrap = requireEl<HTMLElement>('solo-bot-difficulty');
const soloTimerMount = requireEl<HTMLElement>('solo-timer-mount');
const startBtn = requireEl<HTMLButtonElement>('start-btn');
const enterCodeBtn = requireEl<HTMLButtonElement>('enter-code-btn');
const createRoomBtn = requireEl<HTMLButtonElement>('create-room-btn');
const findMatchBtn = requireEl<HTMLButtonElement>('find-match-btn');
const matchmakingStatusEl = requireEl<HTMLElement>('matchmaking-status');
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

const soloConfigFlow = createSoloConfigFlow(
  {
    section: menuSoloSection,
    themePickerWrap: soloThemePickerWrap,
    botDifficultyWrap: soloBotDifficultyWrap,
    playBtn: startBtn,
    timerMount: soloTimerMount,
  },
  themeGrid,
  (config) => {
    showView(null);
    runThemePreview(previewElements, config.themeId, () => {
      if (game) {
        game.setTheme(config.themeId);
        game.setSnippet(config.snippetIndex);
      } else {
        game = new ThemeGuessGame(
          config.themeId,
          config.snippetIndex,
          (id, hex) => soloConfigFlow.handleLocalAssignment(id, hex),
        );
      }
      themeNameBadge.textContent = THEMES[config.themeId].name;
      sound.playApply();
      soloConfigFlow.startTimer(config.timeMode);
    }, () => sound.playOpen());
  },
);

// TODO(#17/#15/#14): wire real flow
enterCodeBtn.addEventListener('click', () => console.log('[menu] enter code clicked (not implemented yet)'));
// TODO(#17/#15/#14): wire real flow
createRoomBtn.addEventListener('click', () => console.log('[menu] create room clicked (not implemented yet)'));
createMatchmakingFlow(
  { findMatchBtn, statusMount: matchmakingStatusEl, themeNameBadge },
  client,
  { showBoard: () => showView(null), showMenu: () => showView('menu') },
);

helpBtn.addEventListener('click', () => showView('menu'));
changeThemeBtn.addEventListener('click', () => showView('menu'));

muteBtn.addEventListener('click', () => {
  const muted = sound.toggleMute();
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

showView('menu');
