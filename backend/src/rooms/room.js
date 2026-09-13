// Private rooms: numeric-code matches for two players who agree on a
// code out-of-band (see PROTOCOL.md "Private rooms"). A room replays
// the same round-session engine (game/session.js) up to 5 times in a
// row, picking a random theme per match (excluding the previous
// match's theme) unless the creator asked for `themeMode: 'chosen'`,
// in which case a 10-second theme vote (rooms/themeVote.js, see
// PROTOCOL.md "Theme voting") settles match 1's theme once; every
// later match in the series reuses that same voted theme (see
// resolveChosenTheme below).
//
// Rooms never import or touch matchmaking's ban store: quitting a
// private room carries no penalty, unlike quitting a matchmaking match.

import { registerHandler, onDisconnect } from '../ws/connectionHandler.js';
import { getPlayerId, getPlayerName, sendTo } from '../ws/registry.js';
import { createSession } from '../game/session.js';
import { pickRandomThemeId } from '../themeIds.js';
import { startVote } from './themeVote.js';

const MAX_MATCHES = 5;
const CODE_MIN = 100000;
const CODE_MAX = 999999;

// code (number) -> room. A room's code is freed (removed from this map)
// as soon as the room closes, so a future room:create can reuse it.
const rooms = new Map();
// playerId -> code, so onDisconnect (which only knows a playerId) can
// find the room a player belongs to without scanning every room.
const roomCodeByPlayerId = new Map();

function generateCode() {
  let code;
  do {
    code = CODE_MIN + Math.floor(Math.random() * (CODE_MAX - CODE_MIN + 1));
  } while (rooms.has(code));
  return code;
}

function otherPlayerId(room, playerId) {
  return room.players.find((id) => id !== playerId);
}

function teardownRoom(room) {
  rooms.delete(room.code);
  for (const id of room.players) {
    roomCodeByPlayerId.delete(id);
  }
}

/**
 * Closes a room whose match just ended via an explicit quit or a
 * mid-match disconnect. game/session.js's own quitSession() already
 * sent `room:playerLeft` + `room:closed` (reason: "quit") to the
 * remaining player before calling onEnd — this just forgets the room.
 */
function closeAfterSessionQuit(room) {
  teardownRoom(room);
}

/**
 * Closes a room the session engine never got a chance to react to:
 * either the 5-match series cap was reached (`matchLimit`), or a
 * player quit/disconnected while no match was in flight (e.g. the
 * creator alone, still waiting for an opponent). Notifies whoever is
 * still connected, then forgets the room.
 */
function closeRoom(room, reason, quitterId) {
  if (reason === 'quit') {
    const remainingId = quitterId === undefined ? undefined : otherPlayerId(room, quitterId);
    if (remainingId) {
      sendTo(remainingId, { type: 'room:playerLeft' });
      sendTo(remainingId, { type: 'room:closed', reason: 'quit' });
    }
  } else {
    for (const id of room.players) {
      sendTo(id, { type: 'room:closed', reason });
    }
  }
  teardownRoom(room);
}

/**
 * `themeMode: 'chosen'` theme resolution: runs the real theme vote
 * (rooms/themeVote.js) for match 1 only. PROTOCOL.md "Theme voting"
 * says the voted theme is reused for the whole 5-match series, so once
 * `room.votedThemeId` is set every later startMatch() call short-
 * circuits straight to it instead of voting again.
 */
function resolveChosenTheme(room, cb) {
  if (room.votedThemeId !== null) {
    cb(room.votedThemeId);
    return;
  }
  startVote(room, (themeId) => {
    // The room may have been torn down (e.g. a player disconnected)
    // while the 10s vote was in flight; don't resurrect it.
    if (!rooms.has(room.code)) return;
    room.votedThemeId = themeId;
    cb(themeId);
  });
}

function resolveTheme(room, cb) {
  if (room.themeMode === 'chosen') {
    resolveChosenTheme(room, cb);
    return;
  }
  // Random mode: uniform pick, excluding the previous match's theme so
  // the same theme never plays twice in a row. Match 1 has no previous
  // theme yet, so nothing is excluded.
  cb(pickRandomThemeId(room.previousThemeId ?? undefined));
}

function startMatch(room) {
  resolveTheme(room, (themeId) => {
    room.currentThemeId = themeId;
    const [playerA, playerB] = room.players;
    room.session = createSession({
      playerA,
      playerB,
      timeMode: room.timeMode,
      themeId,
      onEnd: (reason, quitterId) => handleSessionEnd(room, reason, quitterId),
    });
  });
}

function handleSessionEnd(room, reason, quitterId) {
  if (!rooms.has(room.code)) return; // already torn down

  if (reason === 'quit') {
    closeAfterSessionQuit(room);
    return;
  }

  // Normal completion (round:reveal delivered, no quit).
  room.matchesPlayed += 1;
  room.previousThemeId = room.currentThemeId;

  if (room.matchesPlayed >= MAX_MATCHES) {
    closeRoom(room, 'matchLimit');
    return;
  }

  const nextMatch = room.matchesPlayed + 1;
  for (const id of room.players) {
    sendTo(id, { type: 'round:nextMatch', match: nextMatch });
  }
  startMatch(room);
}

/**
 * Registers this module's message handlers and disconnect hook. Called
 * once from index.js at boot so private rooms are actually reachable.
 */
export function registerRoomHandlers() {
  registerHandler('room:create', (socket, message) => {
    const ownerId = getPlayerId(socket);
    if (!ownerId) return;

    const { timeMode, themeMode } = message;
    if (timeMode !== 2 && timeMode !== 4) return;
    if (themeMode !== 'random' && themeMode !== 'chosen') return;

    const code = generateCode();
    const room = {
      code,
      ownerId,
      timeMode,
      themeMode,
      players: [ownerId],
      matchesPlayed: 0,
      previousThemeId: null,
      currentThemeId: null,
      votedThemeId: null,
      session: null,
    };
    rooms.set(code, room);
    roomCodeByPlayerId.set(ownerId, code);

    sendTo(ownerId, { type: 'room:created', code });
  });

  registerHandler('room:join', (socket, message) => {
    const joinerId = getPlayerId(socket);
    if (!joinerId) return;

    const { code } = message;
    const room = typeof code === 'number' ? rooms.get(code) : undefined;

    if (!room) {
      sendTo(joinerId, { type: 'room:error', reason: 'not_found' });
      return;
    }
    if (room.players.length >= 2 || room.players.includes(joinerId)) {
      sendTo(joinerId, { type: 'room:error', reason: 'full' });
      return;
    }

    room.players.push(joinerId);
    roomCodeByPlayerId.set(joinerId, room.code);

    const ownerName = getPlayerName(room.ownerId) ?? '';
    const joinerName = getPlayerName(joinerId) ?? '';
    sendTo(room.ownerId, {
      type: 'room:joined',
      code: room.code,
      opponentName: joinerName,
      timeMode: room.timeMode,
      themeMode: room.themeMode,
    });
    sendTo(joinerId, {
      type: 'room:joined',
      code: room.code,
      opponentName: ownerName,
      timeMode: room.timeMode,
      themeMode: room.themeMode,
    });

    startMatch(room);
  });

  // Handles a dropped socket identically to an explicit player:quit for
  // room-closing purposes. game/session.js's own onDisconnect hook
  // already runs first (room.js imports session.js, so session.js's
  // top-level onDisconnect() subscription registers before this one)
  // and, for a mid-match disconnect, already tore this room down via
  // handleSessionEnd -> closeAfterSessionQuit, clearing
  // roomCodeByPlayerId for both players. So by the time this fires, a
  // mid-match disconnect is a no-op here; only a disconnect with no
  // active session (e.g. the creator alone, still waiting for an
  // opponent) is still live in `rooms`/`roomCodeByPlayerId` and needs
  // handling here.
  onDisconnect((playerId) => {
    const code = roomCodeByPlayerId.get(playerId);
    if (code === undefined) return;
    const room = rooms.get(code);
    if (!room) return;
    closeRoom(room, 'quit', playerId);
  });
}
