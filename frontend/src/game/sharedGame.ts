// A single `ThemeGuessGame` bound to the page's one `#code-canvas` /
// `#category-panel` / `#reveal-btn` / document-level listeners for its
// entire lifetime. `ThemeGuessGame`'s constructor permanently binds
// fresh event listeners onto those shared, singleton DOM elements and
// never tears them down — constructing a *second* instance while a
// first is still alive would double-bind every click/keydown/mousemove
// handler onto the same elements, corrupting whichever mode the player
// used first (e.g. two live color pickers fighting over the same
// popover).
//
// Solo (`ui/soloConfigFlow.ts`), matchmaking (`ui/matchmakingFlow.ts`),
// and private rooms (`ui/privateRoomFlow.ts`) each start their own
// rounds/matches against the *same* canvas, so they must all share one
// instance rather than each constructing their own — this module is
// that shared instance's sole owner. Call `getSharedGame` every time a
// flow is about to start a round: on the very first call it constructs
// the instance; on every later call it reconfigures the existing one
// (`setTheme`/`setSnippet`) and swaps in the caller's own
// `onCategoryAssigned`, so exactly one set of DOM listeners ever exists,
// always dispatching to whichever flow is currently active.

import { ThemeGuessGame } from './ThemeGuessGame';
import type { CategoryId, ThemeId } from '../types';

let instance: ThemeGuessGame | null = null;

export function getSharedGame(
  themeId: ThemeId,
  snippetIndex: number,
  onCategoryAssigned?: (id: CategoryId, hex: string) => void,
): ThemeGuessGame {
  if (!instance) {
    instance = new ThemeGuessGame(themeId, snippetIndex, onCategoryAssigned);
    return instance;
  }
  instance.setTheme(themeId);
  instance.setSnippet(snippetIndex);
  instance.onCategoryAssigned = onCategoryAssigned;
  return instance;
}
