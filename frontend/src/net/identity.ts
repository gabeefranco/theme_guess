// Per-tab player identity. There is no account system (see
// backend/src/PROTOCOL.md's "Identity" section) — just a stable UUID
// generated once and reused, plus a freely editable display name. Both
// are persisted in sessionStorage so they survive reloads/reconnects
// within a tab but don't leak across tabs — two tabs of the same
// browser (e.g. testing matchmaking/private rooms locally) are two
// distinct players, the same as two separate browsers would be.

const PLAYER_ID_KEY = 'themeGuess.playerId';
const PLAYER_NAME_KEY = 'themeGuess.playerName';

/** Returns the persisted `playerId`, generating and storing a new
 * `crypto.randomUUID()` the first time this tab is seen. */
export function getOrCreatePlayerId(): string {
  const existing = sessionStorage.getItem(PLAYER_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(PLAYER_ID_KEY, created);
  return created;
}

/** Returns the persisted display name, falling back to (and persisting)
 * a generated default derived from the player's id so `identify` never
 * has to send an empty `name`. */
export function getPlayerName(): string {
  const existing = sessionStorage.getItem(PLAYER_NAME_KEY);
  if (existing) return existing;
  const fallback = `Player${getOrCreatePlayerId().slice(0, 4)}`;
  sessionStorage.setItem(PLAYER_NAME_KEY, fallback);
  return fallback;
}

/** Overwrites the persisted display name. */
export function setPlayerName(name: string): void {
  sessionStorage.setItem(PLAYER_NAME_KEY, name);
}
