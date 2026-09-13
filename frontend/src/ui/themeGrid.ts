import { THEMES } from '../data/themes';
import type { ThemeId } from '../types';

const SWATCH_KEYS = ['keyword', 'string', 'function', 'type'] as const;

export interface ThemeGrid {
  readonly selected: ThemeId;
  setSelected(id: ThemeId): void;
  /** Highlights `id` as the opponent's current live pick (theme voting
   * only — see `ui/themeVote.ts`) with its own distinct border color, so
   * it stays visually separate from `selected` (this player's own pick)
   * even when both point at the same card. `null` clears it. */
  setOpponentPick(id: ThemeId | null): void;
}

/** Renders the selectable theme cards into `container` and keeps them in
 * sync with the current selection. `onSelect` fires on every click,
 * including re-clicking the already-selected card. */
export function createThemeGrid(
  container: HTMLElement,
  initialId: ThemeId,
  onSelect: (id: ThemeId) => void,
): ThemeGrid {
  let selected = initialId;
  let opponentPick: ThemeId | null = null;

  function render(): void {
    container.innerHTML = '';
    for (const id in THEMES) {
      const theme = THEMES[id];
      const classes = ['theme-card'];
      if (id === selected) classes.push('selected');
      if (id === opponentPick) classes.push('opponent-pick');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = classes.join(' ');
      card.dataset.id = id;
      card.style.setProperty('--card-bg', theme.colors.background);
      card.innerHTML = `
        <span class="theme-swatches">
          ${SWATCH_KEYS.map((k) => `<i style="background:${theme.colors[k]}"></i>`).join('')}
        </span>
        <span class="theme-name">${theme.name}</span>`;
      card.addEventListener('click', () => {
        selected = id;
        render();
        onSelect(id);
      });
      container.appendChild(card);
    }
  }

  render();

  return {
    get selected() { return selected; },
    setSelected(id: ThemeId) { selected = id; render(); },
    setOpponentPick(id: ThemeId | null) { opponentPick = id; render(); },
  };
}
