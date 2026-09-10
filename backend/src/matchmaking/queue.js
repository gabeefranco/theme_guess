// FIFO-ish matchmaking queue: pairs the two longest-waiting players,
// randomly assigns the round's timeMode and theme (never chosen by
// players, see PROTOCOL.md "Matchmaking"), and hands off to
// game/session.js to run the actual round. Also owns the matchmaking
// quit-ban table (PROTOCOL.md "Quit" > "Matchmaking match").
//
// Registration is exported as registerMatchmakingHandlers() rather than
// running as an import-time side effect, so backend/src/index.js has an
// explicit, greppable call site instead of relying on "importing this
// file happens to register handlers".

import { registerHandler, onDisconnect } from '../ws/connectionHandler.js';
import { getPlayerId, getPlayerName, sendTo } from '../ws/registry.js';
import { createSession } from '../game/session.js';
import { pickRandomThemeId } from '../themeIds.js';

// PROTOCOL.md "Quit": a matchmaking quitter's playerId is banned from
// queue:join for 2 minutes from the moment they quit.
const BAN_DURATION_MS = 2 * 60 * 1000;

// playerId -> { joinedAt } for players waiting to be matched. Map
// preserves insertion order, so its key iteration order is FIFO.
const waiting = new Map();

// playerId -> banUntil (epoch ms). Module-level in-memory state only —
// bans reset whenever the server process restarts.
const bansByPlayerId = new Map();

// playerIds currently in a session THIS module produced, so this
// module's onEnd callback only ever bans for a matchmaking quit, never
// for a private-room quit (session.js is a shared engine with no notion
// of who created a given session).
const activeMatchmakingPlayerIds = new Set();

/**
 * Returns the current matchmaking-ban state for playerId. A ban that has
 * already expired is treated (and cleaned up) as not banned.
 */
export function isBanned(playerId) {
  const banUntil = bansByPlayerId.get(playerId);
  if (banUntil === undefined) return { banned: false };
  if (Date.now() >= banUntil) {
    bansByPlayerId.delete(playerId);
    return { banned: false };
  }
  return { banned: true, until: banUntil };
}

function popOldestWaiting() {
  const playerId = waiting.keys().next().value;
  if (playerId !== undefined) waiting.delete(playerId);
  return playerId;
}

// Pairs off waiting players two at a time for as long as at least two
// are waiting (handles the rare case of several queue:join calls landing
// before this runs, e.g. two players already waiting when a third
// leaves and a fourth joins).
function tryMatch() {
  while (waiting.size >= 2) {
    const playerAId = popOldestWaiting();
    const playerBId = popOldestWaiting();

    const timeMode = Math.random() < 0.5 ? 1 : 2;
    const themeId = pickRandomThemeId();

    activeMatchmakingPlayerIds.add(playerAId);
    activeMatchmakingPlayerIds.add(playerBId);

    createSession({
      playerA: playerAId,
      playerB: playerBId,
      timeMode,
      themeId,
      onEnd: (reason, quitterId) => {
        activeMatchmakingPlayerIds.delete(playerAId);
        activeMatchmakingPlayerIds.delete(playerBId);
        // Only a quit bans; normal completion (reason "reveal") just
        // closes the match with no re-match loop (that's rooms-only).
        if (reason === 'quit' && quitterId) {
          bansByPlayerId.set(quitterId, Date.now() + BAN_DURATION_MS);
        }
      },
    });

    sendTo(playerAId, { type: 'match:found', opponentName: getPlayerName(playerBId) ?? '', timeMode });
    sendTo(playerBId, { type: 'match:found', opponentName: getPlayerName(playerAId) ?? '', timeMode });
  }
}

/**
 * Registers this module's message handlers (queue:join, queue:leave)
 * and disconnect cleanup. Called once from backend/src/index.js at
 * startup.
 */
export function registerMatchmakingHandlers() {
  registerHandler('queue:join', (socket) => {
    const playerId = getPlayerId(socket);
    if (!playerId) return;

    const ban = isBanned(playerId);
    if (ban.banned) {
      sendTo(playerId, { type: 'queue:banned', bannedUntil: ban.until });
      return;
    }

    // Already waiting (duplicate queue:join before being matched): no-op.
    if (waiting.has(playerId)) return;

    waiting.set(playerId, { joinedAt: Date.now() });
    tryMatch();
  });

  registerHandler('queue:leave', (socket) => {
    const playerId = getPlayerId(socket);
    if (!playerId) return;
    waiting.delete(playerId);
  });

  // A dropped socket while still waiting (never matched) just leaves the
  // queue; a drop mid-match is handled by session.js's own onDisconnect
  // subscriber, which drives quitSession -> our onEnd callback above.
  onDisconnect((playerId) => {
    waiting.delete(playerId);
  });
}
