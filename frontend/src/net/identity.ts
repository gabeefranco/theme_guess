// Per-browser player identity. There is no account system (see
// backend/src/PROTOCOL.md's "Identity" section) — just a stable UUID
// generated once and reused, plus a freely editable display name. Both
// are persisted in localStorage so they survive reloads and reconnects.

const PLAYER_ID_KEY = 'themeGuess.playerId';
const PLAYER_NAME_KEY = 'themeGuess.playerName';

/** Returns the persisted `playerId`, generating and storing a new
 * `crypto.randomUUID()` the first time this browser is seen. */
export function getOrCreatePlayerId(): string {
  const existing = localStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(PLAYER_ID_KEY, created);
  return created;
}

/** Returns the persisted display name, falling back to (and persisting)
 * a generated default derived from the player's id so `identify` never
 * has to send an empty `name`. */
export function getPlayerName(): string {
  const existing = localStorage.getItem(PLAYER_NAME_KEY);
  if (existing) return existing;
  const fallback = `Player${getOrCreatePlayerId().slice(0, 4)}`;
  localStorage.setItem(PLAYER_NAME_KEY, fallback);
  return fallback;
}

/** Overwrites the persisted display name. */
export function setPlayerName(name: string): void {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}
