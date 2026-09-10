// Backend-side copy of the frontend's theme id catalog
// (frontend/src/data/themes.ts's `THEMES` object keys), kept in sync by hand
// per backend/src/PROTOCOL.md's snippet/theme identity contracts — the
// backend never needs theme *content* (hex palettes), only valid ids, to:
//   - pick a random theme for matchmaking matches and `themeMode: 'random'`
//     private-room matches (excluding the previous match's theme, see
//     backend/src/rooms/room.js), and
//   - offer the full theme set as `vote:start`'s `themeIds` for
//     `themeMode: 'chosen'` private rooms (see backend/src/rooms/themeVote.js).
//
// If frontend/src/data/themes.ts's THEMES keys ever change, update this
// array to match.
export const THEME_IDS = [
  'gruvbox',
  'tokyoNight',
  'vscode',
  'github',
  'dracula',
  'catppuccin',
];

/** Picks a theme id uniformly at random, optionally excluding one id
 * (used by private rooms to avoid repeating the previous match's theme). */
export function pickRandomThemeId(excludeId) {
  const pool = excludeId ? THEME_IDS.filter((id) => id !== excludeId) : THEME_IDS;
  const candidates = pool.length > 0 ? pool : THEME_IDS;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
