import { CATEGORY_META } from '../data/themes';
import type { CategoryId, CategoryStateMap } from '../types';

function cardFor(panel: HTMLElement, id: CategoryId): HTMLElement {
  const card = panel.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!card) throw new Error(`Missing category card for "${id}"`);
  return card;
}

/** (Re)builds the category cards grid from scratch, wiring each card's
 * click straight back to the caller so this module stays DOM-only. */
export function renderCategoryPanel(
  panel: HTMLElement,
  categories: CategoryStateMap,
  onSelect: (id: CategoryId, card: HTMLElement) => void,
): void {
  panel.innerHTML = '';
  for (const def of CATEGORY_META) {
    const count = categories[def.id].count;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cat-card';
    card.dataset.id = def.id;
    card.innerHTML = `
      <span class="cat-swatch" data-swatch></span>
      <span class="cat-info">
        <span class="cat-label">${def.icon} ${def.label}</span>
        <span class="cat-count">${count || '1'} token${count === 1 ? '' : 's'}</span>
      </span>`;
    card.addEventListener('click', () => onSelect(def.id, card));
    panel.appendChild(card);
  }
}

export function setActiveCard(panel: HTMLElement, id: CategoryId | null): void {
  for (const card of Array.from(panel.children)) {
    card.classList.toggle('active', (card as HTMLElement).dataset.id === id);
  }
}

/** Paints a card's swatch, bounces it, and marks the card as done. */
export function markCategoryAssigned(panel: HTMLElement, id: CategoryId, hex: string): void {
  const card = cardFor(panel, id);
  const swatch = card.querySelector<HTMLElement>('[data-swatch]');
  if (!swatch) return;
  swatch.style.background = hex;
  swatch.classList.remove('pop');
  void swatch.offsetWidth;
  swatch.classList.add('pop');
  card.classList.add('assigned');
}

export function getCardRect(panel: HTMLElement, id: CategoryId): DOMRect {
  return cardFor(panel, id).getBoundingClientRect();
}
