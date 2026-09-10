// Theme voting for `themeMode: 'chosen'` private rooms (see
// PROTOCOL.md "Theme voting"): a single 10-second, server-timed vote
// between a room's two players, run once before match 1's
// `round:start` (room.js reuses the settled theme for matches 2-5).
//
// registerHandler() is global and type-keyed (one handler per message
// type for the whole process, not per-room/per-vote — see
// game/session.js's identical pattern for round:progress/round:submit),
// so `vote:cast` looks up which in-progress vote the sending playerId
// currently belongs to via this module's own playerId -> vote map,
// populated by startVote() and cleared once the vote settles.

import { registerHandler } from '../ws/connectionHandler.js';
import { getPlayerId, sendTo } from '../ws/registry.js';
import { THEME_IDS, pickRandomThemeId } from '../themeIds.js';

const VOTE_DURATION_MS = 10_000;

// playerId -> the in-progress vote both of a room's players belong to.
const voteByPlayerId = new Map();

function otherPlayer(vote, playerId) {
  return vote.players[0] === playerId ? vote.players[1] : vote.players[0];
}

/**
 * Resolves a settled vote's final theme per PROTOCOL.md "Theme voting"
 * Resolution rule: both-agree wins outright; a differing pair splits
 * uniformly at random; a lone cast vote wins by default; no casts at
 * all falls back to a uniform random pick so voting can never stall.
 */
function resolveOutcome(pickA, pickB) {
  if (pickA !== undefined && pickB !== undefined) {
    if (pickA === pickB) return { themeId: pickA, agreed: true };
    return { themeId: Math.random() < 0.5 ? pickA : pickB, agreed: false };
  }
  if (pickA !== undefined) return { themeId: pickA, agreed: false };
  if (pickB !== undefined) return { themeId: pickB, agreed: false };
  return { themeId: pickRandomThemeId(), agreed: false };
}

function settleVote(vote) {
  if (vote.settled) return;
  vote.settled = true;
  for (const id of vote.players) voteByPlayerId.delete(id);

  const [playerA, playerB] = vote.players;
  const { themeId, agreed } = resolveOutcome(vote.picks.get(playerA), vote.picks.get(playerB));

  for (const id of vote.players) {
    sendTo(id, { type: 'vote:settled', themeId, agreed });
  }
  vote.onSettled(themeId);
}

/**
 * Starts a 10-second theme vote between `room.players` (exactly two
 * playerIds). Calls `onSettled(themeId)` exactly once, at the 10s mark
 * — never early, even if both players already agree (PROTOCOL.md
 * "Theme voting": `vote:settled` only fires once `endsAt` elapses).
 */
export function startVote(room, onSettled) {
  const endsAt = Date.now() + VOTE_DURATION_MS;
  const vote = {
    players: room.players,
    picks: new Map(),
    settled: false,
    onSettled,
  };
  for (const id of vote.players) voteByPlayerId.set(id, vote);

  for (const id of vote.players) {
    sendTo(id, { type: 'vote:start', themeIds: THEME_IDS, endsAt });
  }

  setTimeout(() => settleVote(vote), Math.max(0, endsAt - Date.now()));
}

registerHandler('vote:cast', (socket, message) => {
  const playerId = getPlayerId(socket);
  const vote = voteByPlayerId.get(playerId);
  if (!vote || vote.settled) return;

  const { themeId } = message;
  if (!THEME_IDS.includes(themeId)) return;

  vote.picks.set(playerId, themeId);
  sendTo(otherPlayer(vote, playerId), { type: 'vote:opponentChoice', themeId });
});
