import { THEMES } from '../data/themes';
import { pickRandomSnippetIndex } from '../data/snippets';
import type { BotDifficulty, BotTimeMode } from '../engine/bot';
import type { ThemeId } from '../types';
import type { ThemeGrid } from './themeGrid';

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
  opponent: SoloOpponent;
  botDifficulty: BotDifficulty;
}

export interface SoloConfigFlowElements {
  /** Root of the #menu-solo section; radios are looked up inside it by
   * `name` so this module owns its own markup instead of main.ts wiring
   * every individual input. */
  section: HTMLElement;
  /** Wrapper around the reused theme grid, shown only in "choose" mode. */
  themePickerWrap: HTMLElement;
  /** Wrapper around the difficulty radios, shown only in "vs bot" mode. */
  botDifficultyWrap: HTMLElement;
  playBtn: HTMLButtonElement;
  /** Empty mount point (outside the menu modal) the inline timer/mode
   * badge HUD renders itself into. */
  timerMount: HTMLElement;
}

export interface SoloConfigFlow {
  /** Starts the inline countdown/elapsed-time HUD for a just-started
   * round. Call once the round is actually live (e.g. after the theme
   * preview finishes), not at Play-click time. */
  startTimer(mode: SoloTimeMode): void;
}

const TIME_MODE_DEADLINE_MS: Record<Exclude<SoloTimeMode, 'none'>, number> = {
  '1min': 60_000,
  '2min': 120_000,
};

const TIME_MODE_LABEL: Record<SoloTimeMode, string> = {
  '1min': '1 MIN',
  '2min': '2 MIN',
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

/** Minimal inline countdown (1/2 minute modes) or elapsed-time counter
 * ("no limit") plus a mode badge, rendered into `mount`. Purely a
 * display: it never forces a reveal, since `ThemeGuessGame.reveal()`
 * stays manually triggered by the existing Reveal button in every time
 * mode, "no limit" included.
 * TODO: replace with shared timerHud module once available. */
function createTimerHud(mount: HTMLElement): SoloConfigFlow['startTimer'] {
  mount.innerHTML = `
    <div class="solo-timer-hud hidden">
      <span class="solo-timer-badge"></span>
      <span class="solo-timer-clock">00:00</span>
    </div>`;
  const root = mount.querySelector<HTMLElement>('.solo-timer-hud')!;
  const badge = mount.querySelector<HTMLElement>('.solo-timer-badge')!;
  const clock = mount.querySelector<HTMLElement>('.solo-timer-clock')!;
  let intervalId: number | null = null;

  function stop(): void {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  return function startTimer(mode: SoloTimeMode): void {
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
      clock.textContent = formatClock(remaining);
      if (remaining <= 0) stop();
    }

    tick();
    intervalId = window.setInterval(tick, 250);
  };
}

/** Wires the Solo menu section's config form (time mode / theme mode /
 * opponent, with the theme grid and bot difficulty picker revealed
 * conditionally) and its inline timer HUD. Fires `onStart` with the
 * resolved config once the player clicks Play. */
export function createSoloConfigFlow(
  elements: SoloConfigFlowElements,
  themeGrid: ThemeGrid,
  onStart: (config: SoloConfig) => void,
): SoloConfigFlow {
  const themeModeInputs = radios(elements.section, 'solo-theme-mode');
  const opponentInputs = radios(elements.section, 'solo-opponent-mode');
  const timeModeInputs = radios(elements.section, 'solo-time-mode');
  const botDifficultyInputs = radios(elements.section, 'solo-bot-difficulty');
  const startTimer = createTimerHud(elements.timerMount);

  function syncThemePicker(): void {
    const mode = checkedValue<SoloThemeMode>(themeModeInputs, 'random');
    elements.themePickerWrap.classList.toggle('hidden', mode !== 'choose');
  }

  function syncBotDifficulty(): void {
    const opponent = checkedValue<SoloOpponent>(opponentInputs, 'alone');
    elements.botDifficultyWrap.classList.toggle('hidden', opponent !== 'bot');
  }

  for (const input of themeModeInputs) input.addEventListener('change', syncThemePicker);
  for (const input of opponentInputs) input.addEventListener('change', syncBotDifficulty);
  syncThemePicker();
  syncBotDifficulty();

  elements.playBtn.addEventListener('click', () => {
    const timeMode = checkedValue<SoloTimeMode>(timeModeInputs, '1min');
    const themeMode = checkedValue<SoloThemeMode>(themeModeInputs, 'random');
    const opponent = checkedValue<SoloOpponent>(opponentInputs, 'alone');
    const botDifficulty = checkedValue<BotDifficulty>(botDifficultyInputs, 'easy');

    const themeIds = Object.keys(THEMES) as ThemeId[];
    const themeId = themeMode === 'choose'
      ? themeGrid.selected
      : themeIds[Math.floor(Math.random() * themeIds.length)];

    // TODO(#19): wire bot engine — opponent/botDifficulty are captured
    // and handed off here, but nothing yet drives a live bot opponent
    // from them; "vs Bot" currently plays identically to "Alone".
    onStart({
      themeId,
      snippetIndex: pickRandomSnippetIndex(),
      timeMode,
      opponent,
      botDifficulty,
    });
  });

  return { startTimer };
}
