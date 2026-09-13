// Server-authoritative round session engine, shared by matchmaking and
// private-room matches (see PROTOCOL.md "Round lifecycle (shared by
// matchmaking and rooms)"). A session owns exactly one round: picking a
// snippet, running the countdown, relaying opponent progress, firing the
// one-time 20s warning, and delivering a synchronized reveal. It knows
// nothing about matchmaking bans, ban tables, or private-room match-count
// limits — that all lives upstream, in the (not-yet-written)
// backend/src/matchmaking/ and backend/src/rooms/ modules, which call
// createSession() and react to onEnd().

import { getPlayerId, sendTo } from '../ws/registry.js';
import { registerHandler, onDisconnect } from '../ws/connectionHandler.js';

// PROTOCOL.md "Snippet identity contract": the server never hardcodes
// snippet content or count, only the frontend catalog's length, so it can
// pick a valid random snippetIndex. Env-configurable, default 6.
export const SNIPPET_CATALOG_LENGTH = Number(process.env.SNIPPET_CATALOG_LENGTH) || 6;

// PROTOCOL.md "round:timeWarning": fired exactly once, 20s before endsAt.
const WARNING_OFFSET_MS = 20_000;
// Short grace window after endsAt for a straggling round:submit before the
// server reveals with whatever it has (empty color map for a client that
// never submitted).
const SUBMIT_GRACE_MS = 3_000;

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{3,8}$/;

// registerHandler() is global and type-keyed (one handler per message
// type for the whole process), not per-session, so round:progress,
// round:submit, and player:quit all look up which active session the
// sending playerId currently belongs to via this map, updated on
// createSession() and cleared when a session ends.
const sessionsByPlayerId = new Map();

function isPlainCategoryId(value) {
  // A CategoryId is a short identifier string (e.g. "keyword",
  // "background"); reject anything empty, non-string, or shaped like a
  // hex color so a misbehaving/malicious client can't smuggle a color
  // value through round:progress.
  return typeof value === 'string' && value.length > 0 && !HEX_COLOR_PATTERN.test(value);
}

function otherPlayer(session, playerId) {
  return session.playerA === playerId ? session.playerB : session.playerA;
}

function clearSessionTimers(session) {
  clearTimeout(session.warningTimer);
  clearTimeout(session.endTimer);
  clearTimeout(session.graceTimer);
}

function endSession(session) {
  if (session.ended) return;
  session.ended = true;
  clearSessionTimers(session);
  sessionsByPlayerId.delete(session.playerA);
  sessionsByPlayerId.delete(session.playerB);
}

function revealSession(session) {
  if (session.ended) return;
  clearTimeout(session.graceTimer);
  session.graceTimer = null;

  const colors = {
    [session.playerA]: session.submissions.get(session.playerA) ?? {},
    [session.playerB]: session.submissions.get(session.playerB) ?? {},
  };
  const payload = { type: 'round:reveal', colors };
  sendTo(session.playerA, payload);
  sendTo(session.playerB, payload);

  endSession(session);
  session.onEnd?.('reveal', null);
}

function tryReveal(session) {
  if (!session.roundEnded || session.ended) return;
  const bothSubmitted = session.submissions.has(session.playerA) && session.submissions.has(session.playerB);
  if (bothSubmitted) {
    revealSession(session);
    return;
  }
  if (!session.graceTimer) {
    session.graceTimer = setTimeout(() => revealSession(session), SUBMIT_GRACE_MS);
  }
}

function quitSession(session, quitterId) {
  if (session.ended) return;
  const remainingId = otherPlayer(session, quitterId);
  // PROTOCOL.md "Quit": opponent gets room:playerLeft then room:closed
  // (reason: "quit").
  sendTo(remainingId, { type: 'room:playerLeft' });
  sendTo(remainingId, { type: 'room:closed', reason: 'quit' });
  endSession(session);
  session.onEnd?.('quit', quitterId);
}

/**
 * Starts one round session between two already-identified players.
 * `timeMode` is 2 or 4 (minutes, per PROTOCOL.md); `themeId` and
 * `snippetIndex` are decided upstream (or `snippetIndex` is picked
 * randomly here if omitted). Sends round:start to both sockets
 * immediately and returns the session object.
 */
export function createSession({ playerA, playerB, timeMode, themeId, snippetIndex, onEnd }) {
  if (typeof playerA !== 'string' || playerA.length === 0) {
    throw new Error('createSession requires a string playerA');
  }
  if (typeof playerB !== 'string' || playerB.length === 0) {
    throw new Error('createSession requires a string playerB');
  }
  if (playerA === playerB) {
    throw new Error('createSession requires two distinct players');
  }

  const resolvedSnippetIndex = Number.isInteger(snippetIndex)
    ? snippetIndex
    : Math.floor(Math.random() * SNIPPET_CATALOG_LENGTH);

  const endsAt = Date.now() + timeMode * 60_000;

  const session = {
    playerA,
    playerB,
    timeMode,
    themeId,
    snippetIndex: resolvedSnippetIndex,
    endsAt,
    onEnd,
    submissions: new Map(),
    ended: false,
    roundEnded: false,
    warningTimer: null,
    endTimer: null,
    graceTimer: null,
  };

  sessionsByPlayerId.set(playerA, session);
  sessionsByPlayerId.set(playerB, session);

  const startPayload = {
    type: 'round:start',
    snippetIndex: resolvedSnippetIndex,
    themeId,
    timeMode,
    endsAt,
  };
  sendTo(playerA, startPayload);
  sendTo(playerB, startPayload);

  session.warningTimer = setTimeout(() => {
    sendTo(playerA, { type: 'round:timeWarning' });
    sendTo(playerB, { type: 'round:timeWarning' });
  }, Math.max(0, endsAt - WARNING_OFFSET_MS - Date.now()));

  session.endTimer = setTimeout(() => {
    session.roundEnded = true;
    tryReveal(session);
  }, Math.max(0, endsAt - Date.now()));

  return session;
}

registerHandler('round:progress', (socket, message) => {
  const playerId = getPlayerId(socket);
  const session = sessionsByPlayerId.get(playerId);
  if (!session || session.ended) return;

  const { categoryId } = message;
  // Payload must carry only a category id — never a color value.
  if (!isPlainCategoryId(categoryId) || 'color' in message || 'colors' in message) return;

  sendTo(otherPlayer(session, playerId), { type: 'round:progress', categoryId });
});

registerHandler('round:submit', (socket, message) => {
  const playerId = getPlayerId(socket);
  const session = sessionsByPlayerId.get(playerId);
  if (!session || session.ended) return;

  const colors =
    message.colors && typeof message.colors === 'object' && !Array.isArray(message.colors) ? message.colors : {};
  session.submissions.set(playerId, colors);
  tryReveal(session);
});

registerHandler('player:quit', (socket) => {
  const playerId = getPlayerId(socket);
  const session = sessionsByPlayerId.get(playerId);
  if (!session) return;
  quitSession(session, playerId);
});

// A dropped socket mid-round is handled identically to an explicit
// player:quit.
onDisconnect((playerId) => {
  const session = sessionsByPlayerId.get(playerId);
  if (!session) return;
  quitSession(session, playerId);
});
