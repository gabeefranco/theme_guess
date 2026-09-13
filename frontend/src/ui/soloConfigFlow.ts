import { THEMES } from '../data/themes';
import { pickRandomSnippetIndex } from '../data/snippets';
import type { BotDifficulty, BotTimeMode } from '../engine/bot';
import { sound } from '../engine/sound';
import { BotMatch } from '../game/botMatch';
import { getSharedGame } from '../game/sharedGame';
import type { ThemeGuessGame } from '../game/ThemeGuessGame';
import type { ThemeId } from '../types';
import type { PreviewFlowElements } from './previewFlow';
import { runThemePreview } from './previewFlow';
import { createThemeGrid } from './themeGrid';

/** Reuses `engine/bot`'s time-mode vocabulary so a solo config can be
 * handed straight to `computeBotSchedule` once the bot opponent path
 * (#19) is wired up. */
export type SoloTimeMode = BotTimeMode;
export type SoloOpponent = 'alone' | 'bot';
type SoloThemeMode = 'random' | 'choose';

export interface SoloConfig {
  themeId: ThemeId;
  snippetIndex: number;
  timeMode: SoloTimeMode;
  themeMode: SoloThemeMode;
  opponent: SoloOpponent;
  botDifficulty: BotDifficulty;
}

/** Everything a round needs except the theme itself — resolved from the
 * menu form (or carried over from `lastConfig` on "Play Again") before
 * the theme-picker modal supplies the last piece. */
type PendingSoloConfig = Omit<SoloConfig, 'themeId' | 'snippetIndex'>;

export interface SoloConfigFlowElements {
  /** Root of the #menu-solo section; radios are looked up inside it by
   * `name` so this module owns its own markup instead of main.ts wiring
   * every individual input. */
  section: HTMLElement;
  /** Wrapper around the difficulty radios, shown only in "vs bot" mode. */
  botDifficultyWrap: HTMLElement;
  playBtn: HTMLButtonElement;
  /** Empty mount point (outside the menu modal) the inline timer/mode
   * badge/quit-button HUD renders itself into. */
  timerMount: HTMLElement;
  /** Topbar badge showing the active theme's name. */
  themeNameBadge: HTMLElement;
  /** Mounts for the pre-round "flash the real theme" overlay. */
  preview: PreviewFlowElements;
  /** Standalone "pick a theme" modal shown after Play or Play Again in
   * chosen-theme mode — never inline in the settings menu. */
  themePicker: {
    overlay: HTMLElement;
    gridMount: HTMLElement;
    cancelBtn: HTMLButtonElement;
  };
  /** Result-modal button shown for as long as a solo/bot round is
   * active — does the same "back to the main menu" thing the old
   * change-theme button used to, plus solo cleanup (stops the bot,
   * hides the timer HUD). */
  backToMenuBtn: HTMLButtonElement;
}

export interface SoloConfigFlowHooks {
  /** Hides every top-level overlay so the board is visible. */
  hideMenu: () => void;
  /** Shows the main menu (also hides the result modal, if open — see
   * main.ts's `showView`). */
  showMenu: () => void;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const TIME_MODE_DEADLINE_MS: Record<Exclude<SoloTimeMode, 'none'>, number> = {
  '2min': 120_000,
  '4min': 240_000,
};

const TIME_MODE_LABEL: Record<SoloTimeMode, string> = {
  '2min': '2 MIN',
  '4min': '4 MIN',
  none: 'NO LIMIT',
};

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function radios(section: HTMLElement, name: string): HTMLInputElement[] {
  return Array.from(section.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
}

function checkedValue<T extends string>(inputs: HTMLInputElement[], fallback: T): T {
  return (inputs.find((input) => input.checked)?.value as T | undefined) ?? fallback;
}

/** Offline (solo/bot) anti-repeat memory: the last theme actually
 * played, persisted so a page reload doesn't immediately re-serve it.
 * Multiplayer theme selection (server-assigned or voted) never touches
 * this key. */
const LAST_THEME_STORAGE_KEY = 'theme-guess:last-solo-theme';

function isThemeId(value: string): value is ThemeId {
  return value in THEMES;
}

function readLastTheme(): ThemeId | null {
  try {
    const stored = window.localStorage.getItem(LAST_THEME_STORAGE_KEY);
    return stored && isThemeId(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeLastTheme(themeId: ThemeId): void {
  try {
    window.localStorage.setItem(LAST_THEME_STORAGE_KEY, themeId);
  } catch {
    // Storage unavailable (private browsing, disabled) — anti-repeat
    // just resets every page load instead of persisting across them.
  }
}

/** Picks a random theme other than `exclude`, falling back to the full
 * pool if excluding it would leave nothing to pick from. */
function pickRandomTheme(exclude: ThemeId | null): ThemeId {
  const ids = Object.keys(THEMES) as ThemeId[];
  const pool = exclude ? ids.filter((id) => id !== exclude) : ids;
  const candidates = pool.length > 0 ? pool : ids;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

interface TimerHud {
  /** Starts (or restarts) the countdown/elapsed-time display. `onExpire`,
   * on the two clocked modes only, fires exactly once when the countdown
   * reaches zero. */
  start(mode: SoloTimeMode, onExpire?: () => void): void;
  /** Stops the ticking interval without hiding the HUD. */
  stop(): void;
  /** Stops and hides the whole HUD (including the quit button). */
  hide(): void;
}

/** Minimal inline countdown (2/4 minute modes) or elapsed-time counter
 * ("no limit") plus a mode badge and an always-available Quit button,
 * rendered into `mount`.
 * TODO: replace with shared timerHud module once available. */
function createTimerHud(mount: HTMLElement, onQuit: () => void): TimerHud {
  mount.innerHTML = `
    <div class="solo-timer-hud hidden">
      <span class="solo-timer-badge"></span>
      <span class="solo-timer-clock">00:00</span>
      <button type="button" class="solo-timer-quit btn danger small">✕ Quit</button>
    </div>`;
  const root = mount.querySelector<HTMLElement>('.solo-timer-hud')!;
  const badge = mount.querySelector<HTMLElement>('.solo-timer-badge')!;
  const clock = mount.querySelector<HTMLElement>('.solo-timer-clock')!;
  const quitBtn = mount.querySelector<HTMLButtonElement>('.solo-timer-quit')!;
  quitBtn.addEventListener('click', onQuit);
  let intervalId: number | null = null;

  function stop(): void {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function start(mode: SoloTimeMode, onExpire?: () => void): void {
    stop();
    root.classList.remove('hidden');
    badge.textContent = TIME_MODE_LABEL[mode];
    const startedAt = performance.now();

    function tick(): void {
      const elapsed = performance.now() - startedAt;
      if (mode === 'none') {
        clock.textContent = formatClock(elapsed);
        return;
      }
      const remaining = TIME_MODE_DEADLINE_MS[mode] - elapsed;
      clock.textContent = formatClock(Math.max(0, remaining));
      if (remaining <= 0) {
        stop();
        onExpire?.();
      }
    }

    tick();
    intervalId = window.setInterval(tick, 250);
  }

  function hide(): void {
    stop();
    root.classList.add('hidden');
  }

  return { start, stop, hide };
}

/** Wires the Solo menu section's config form (time mode / theme mode /
 * opponent, with the bot difficulty picker revealed conditionally and
 * theme choice deferred to a standalone modal), its inline timer/quit
 * HUD, and every shared result-modal button ("Keep Comparing" / "Play
 * Again" / the change-theme/back-to-menu swap) for as long as a solo
 * round is the thing driving the shared board — see `soloActive`. */
export function createSoloConfigFlow(
  elements: SoloConfigFlowElements,
  hooks: SoloConfigFlowHooks,
): void {
  const themeModeInputs = radios(elements.section, 'solo-theme-mode');
  const opponentInputs = radios(elements.section, 'solo-opponent-mode');
  const timeModeInputs = radios(elements.section, 'solo-time-mode');
  const botDifficultyInputs = radios(elements.section, 'solo-bot-difficulty');
  const closeResultBtn = requireEl<HTMLButtonElement>('close-result-btn');
  const playAgainBtn = requireEl<HTMLButtonElement>('play-again-btn');
  const botMatch = new BotMatch();

  let lastConfig: SoloConfig | null = null;
  let activeGame: ThemeGuessGame | null = null;
  /** The non-theme settings a theme-picker-modal selection will complete
   * into a full round — set whenever the modal opens, cleared once it's
   * dismissed (by pick or Cancel). */
  let pendingConfig: PendingSoloConfig | null = null;
  /** True from the moment a solo round starts until the player quits —
   * guards the shared, page-global result-modal buttons and the Quit
   * button so a stale click from a leftover matchmaking/private-room
   * result doesn't reroute solo state, and vice versa. */
  let soloActive = false;

  const timerHud = createTimerHud(elements.timerMount, quit);

  const themeGrid = createThemeGrid(elements.themePicker.gridMount, 'gruvbox', (themeId) => {
    sound.playOpen();
    if (!pendingConfig) return;
    const config = pendingConfig;
    closeThemePicker();
    beginRound({ ...config, themeId, snippetIndex: pickRandomSnippetIndex() });
  });
  void themeGrid;

  function openThemePicker(config: PendingSoloConfig): void {
    pendingConfig = config;
    elements.themePicker.overlay.classList.remove('hidden');
  }

  function closeThemePicker(): void {
    pendingConfig = null;
    elements.themePicker.overlay.classList.add('hidden');
  }

  elements.themePicker.cancelBtn.addEventListener('click', () => {
    closeThemePicker();
    hooks.showMenu();
  });

  function syncBotDifficulty(): void {
    const opponent = checkedValue<SoloOpponent>(opponentInputs, 'alone');
    elements.botDifficultyWrap.classList.toggle('hidden', opponent !== 'bot');
  }

  for (const input of opponentInputs) input.addEventListener('change', syncBotDifficulty);
  syncBotDifficulty();

  /** Starts (or restarts) a live round from a fully-resolved config:
   * flashes the theme preview, then swaps the shared `ThemeGuessGame`
   * onto it, arms the timer HUD, and starts/stops the bot opponent. */
  function beginRound(config: SoloConfig): void {
    lastConfig = config;
    soloActive = true;
    writeLastTheme(config.themeId);
    elements.backToMenuBtn.classList.remove('hidden');
    hooks.hideMenu();
    runThemePreview(elements.preview, config.themeId, () => {
      const game = getSharedGame(config.themeId, config.snippetIndex, (id, hex) => botMatch.handleLocalAssignment(id, hex));
      activeGame = game;
      botMatch.bindGame(game);
      elements.themeNameBadge.textContent = THEMES[config.themeId].name;
      sound.playApply();

      const vsBot = config.opponent === 'bot';
      // Bot rounds end themselves at the same deadline (`BotMatch.start`'s
      // own `ROUND_DEADLINE_MS` timeout) and render the two-column
      // scoreboard; forwarding `onExpire` there too would race it into
      // also opening the solo (single-score) result view. Alone rounds
      // have nothing else watching the clock, so they need it.
      timerHud.start(config.timeMode, vsBot ? undefined : () => game.reveal());
      if (vsBot) {
        botMatch.start({
          themeId: config.themeId,
          snippetIndex: config.snippetIndex,
          timeMode: config.timeMode,
          difficulty: config.botDifficulty,
        });
      } else {
        botMatch.stop();
      }
    }, () => sound.playOpen());
  }

  elements.playBtn.addEventListener('click', () => {
    const timeMode = checkedValue<SoloTimeMode>(timeModeInputs, '2min');
    const themeMode = checkedValue<SoloThemeMode>(themeModeInputs, 'random');
    const opponent = checkedValue<SoloOpponent>(opponentInputs, 'alone');
    const botDifficulty = checkedValue<BotDifficulty>(botDifficultyInputs, 'easy');
    const base: PendingSoloConfig = { timeMode, themeMode, opponent, botDifficulty };

    if (themeMode === 'choose') {
      hooks.hideMenu();
      openThemePicker(base);
      return;
    }

    beginRound({ ...base, themeId: pickRandomTheme(readLastTheme()), snippetIndex: pickRandomSnippetIndex() });
  });

  /** "Keep Comparing": lets the player keep tweaking colors after a
   * reveal instead of being stuck admiring the score. Unlocks the
   * Reveal button for the rest of the round (`enableExtendedPlay`) and
   * restarts the HUD in elapsed-time "NO LIMIT" mode — an explicit
   * countdown still running would otherwise force another auto-reveal
   * mid-tweak (see `beginRound`'s `onExpire`). */
  function keepComparing(): void {
    if (!soloActive || !activeGame) return;
    activeGame.enableExtendedPlay();
    timerHud.start('none');
  }

  /** "Play Again": a random-theme round immediately rerolls a new theme
   * (never repeating the last one played) and snippet, and starts over
   * with no extra input needed. A chosen-theme round instead reopens the
   * standalone theme-picker modal, carrying over every other setting, so
   * the player picks their next theme the same way a fresh round does. */
  function playAgain(): void {
    if (!soloActive || !lastConfig) return;
    const base: PendingSoloConfig = {
      timeMode: lastConfig.timeMode,
      themeMode: lastConfig.themeMode,
      opponent: lastConfig.opponent,
      botDifficulty: lastConfig.botDifficulty,
    };

    if (lastConfig.themeMode === 'choose') {
      openThemePicker(base);
      return;
    }

    beginRound({ ...base, themeId: pickRandomTheme(readLastTheme()), snippetIndex: pickRandomSnippetIndex() });
  }

  /** Ends the active solo round and returns to the main menu — wired to
   * the timer HUD's own Quit button (visible for as long as a solo round
   * is live) and the result modal's "Back to Menu" button. */
  function quit(): void {
    if (!soloActive) return;
    soloActive = false;
    botMatch.stop();
    timerHud.hide();
    elements.backToMenuBtn.classList.add('hidden');
    hooks.showMenu();
  }

  elements.backToMenuBtn.addEventListener('click', quit);
  closeResultBtn.addEventListener('click', keepComparing);
  playAgainBtn.addEventListener('click', playAgain);
}
