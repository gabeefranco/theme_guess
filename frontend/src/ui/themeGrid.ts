import { THEMES } from '../data/themes';
import type { ThemeId } from '../types';

const SWATCH_KEYS = ['keyword', 'string', 'function', 'type'] as const;

export interface ThemeGrid {
  readonly selected: ThemeId;
  setSelected(id: ThemeId): void;
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

  function render(): void {
    container.innerHTML = '';
    for (const id in THEMES) {
      const theme = THEMES[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `theme-card${id === selected ? ' selected' : ''}`;
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
  };
}
