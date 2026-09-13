import './style.css';
import { sound } from './engine/sound';
import { createSoloConfigFlow } from './ui/soloConfigFlow';
import { createMatchmakingFlow } from './ui/matchmakingFlow';
import { createPrivateRoomFlow } from './ui/privateRoomFlow';
import { client } from './net/client';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const menuModal = requireEl<HTMLElement>('intro-modal');
const resultModal = requireEl<HTMLElement>('result-modal');
const menuSoloSection = requireEl<HTMLElement>('menu-solo');
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
const backToMenuBtn = requireEl<HTMLButtonElement>('back-to-menu-btn');
const privateRoomMount = requireEl<HTMLElement>('private-room-mount');

const previewElements = {
  overlay: requireEl<HTMLElement>('preview-overlay'),
  countdown: requireEl<HTMLElement>('preview-countdown'),
  caption: requireEl<HTMLElement>('preview-caption'),
  canvas: requireEl<HTMLCanvasElement>('preview-canvas'),
};

const themePickerElements = {
  overlay: requireEl<HTMLElement>('theme-picker-modal'),
  gridMount: requireEl<HTMLElement>('theme-picker-grid'),
  cancelBtn: requireEl<HTMLButtonElement>('theme-picker-cancel-btn'),
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

createSoloConfigFlow(
  {
    section: menuSoloSection,
    botDifficultyWrap: soloBotDifficultyWrap,
    playBtn: startBtn,
    timerMount: soloTimerMount,
    themeNameBadge,
    preview: previewElements,
    themePicker: themePickerElements,
    changeThemeBtn,
    backToMenuBtn,
  },
  { hideMenu: () => showView(null), showMenu: () => showView('menu') },
);

const privateRoomFlow = createPrivateRoomFlow(
  client,
  { mount: privateRoomMount, themeNameBadge },
  { hideMenu: () => showView(null), showMenu: () => showView('menu') },
);

enterCodeBtn.addEventListener('click', () => privateRoomFlow.openJoin());
createRoomBtn.addEventListener('click', () => privateRoomFlow.openCreate());

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
