import { ThemeGuessGame } from './game.js';
import { THEMES } from './theme.js';
import { sound } from './sound.js';
import { renderThemePreview } from './preview.js';

const introModal = document.getElementById('intro-modal');
const themeGrid = document.getElementById('theme-grid');
const startBtn = document.getElementById('start-btn');
const helpBtn = document.getElementById('help-btn');
const muteBtn = document.getElementById('mute-btn');
const themeNameBadge = document.getElementById('theme-name-badge');
const changeThemeBtn = document.getElementById('change-theme-btn');
const resultModal = document.getElementById('result-modal');

const previewOverlay = document.getElementById('preview-overlay');
const previewCountdown = document.getElementById('preview-countdown');
const previewCaption = document.getElementById('preview-caption');
const previewCanvas = document.getElementById('preview-canvas');

const SWATCH_KEYS = ['keyword', 'string', 'function', 'type'];
const COUNTDOWN_SECONDS = 5;

let selectedTheme = 'gruvbox';
let game = null;

function renderThemeGrid() {
  themeGrid.innerHTML = '';
  for (const id in THEMES) {
    const theme = THEMES[id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card${id === selectedTheme ? ' selected' : ''}`;
    card.dataset.id = id;
    card.style.setProperty('--card-bg', theme.colors.background);
    card.innerHTML = `
      <span class="theme-swatches">
        ${SWATCH_KEYS.map((k) => `<i style="background:${theme.colors[k]}"></i>`).join('')}
      </span>
      <span class="theme-name">${theme.name}</span>`;
    card.addEventListener('click', () => {
      selectedTheme = id;
      renderThemeGrid();
      sound.playOpen();
    });
    themeGrid.appendChild(card);
  }
}

function bumpCountdown(text) {
  previewCountdown.textContent = text;
  previewCountdown.classList.remove('tick');
  void previewCountdown.offsetWidth;
  previewCountdown.classList.add('tick');
}

// Flashes a *different* snippet, fully colored with the real theme (and
// deliberately missing a few token kinds so it isn't a complete answer
// key), for a few seconds before the round actually starts.
function runThemePreview(themeId, onDone) {
  renderThemePreview(previewCanvas, themeId);
  previewCaption.textContent = `LOADING: ${THEMES[themeId].name.toUpperCase()}`;
  previewOverlay.classList.remove('hidden');

  let remaining = COUNTDOWN_SECONDS;
  bumpCountdown(remaining);
  sound.playOpen();

  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      previewOverlay.classList.add('hidden');
      onDone();
      return;
    }
    bumpCountdown(remaining);
    sound.playOpen();
  }, 1000);
}

function startWithSelectedTheme() {
  introModal.classList.add('hidden');
  runThemePreview(selectedTheme, () => {
    if (game) game.setTheme(selectedTheme);
    else game = new ThemeGuessGame(selectedTheme);
    themeNameBadge.textContent = THEMES[selectedTheme].name;
    sound.playApply();
  });
}

renderThemeGrid();
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
