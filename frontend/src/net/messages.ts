// Hand-maintained TypeScript twin of the WebSocket JSON contract
// described in `backend/src/PROTOCOL.md`. There is no shared
// package/codegen between frontend and backend (see AGENTS.md), so this
// file only exists to give the frontend compile-time safety around
// message shapes — `backend/src/PROTOCOL.md` is the source of truth;
// keep this in sync with it by hand whenever the protocol changes.

import type { CategoryId, ThemeId } from '../types';

export type TimeMode = 2 | 4;
export type ThemeMode = 'random' | 'chosen';
export type RoomErrorReason = 'not_found' | 'full';
export type RoomClosedReason = 'quit' | 'matchLimit' | 'finished';

// -- Identity -----------------------------------------------------------

/** Client -> server, always the first message on a connection. */
export interface IdentifyMessage {
  type: 'identify';
  playerId: string;
  name: string;
}

/** Server -> client, acknowledges `identify`. */
export interface IdentifyAckMessage {
  type: 'identify:ack';
}

// -- Round lifecycle (shared by matchmaking and rooms) -------------------

/** Server -> both players, start of a round. */
export interface RoundStartMessage {
  type: 'round:start';
  snippetIndex: number;
  themeId: ThemeId;
  timeMode: TimeMode;
  endsAt: number;
}

/** Client -> server -> relayed to opponent; fired per category painted.
 * Carries only which category changed, never the color value. */
export interface RoundProgressMessage {
  type: 'round:progress';
  categoryId: CategoryId;
}

/** Server -> both players, fired once, 20s before `endsAt`. */
export interface RoundTimeWarningMessage {
  type: 'round:timeWarning';
}

/** Client -> server, a player's final full guess. */
export interface RoundSubmitMessage {
  type: 'round:submit';
  colors: Record<CategoryId, string>;
}

/** Server -> both players, sent once `endsAt` has passed. Keyed by both
 * players' `playerId`; a player who never submitted may be omitted. */
export interface RoundRevealMessage {
  type: 'round:reveal';
  colors: Record<string, Record<CategoryId, string>>;
}

/** Server -> both players, private rooms only: next match in the series
 * is about to start. */
export interface RoundNextMatchMessage {
  type: 'round:nextMatch';
  match: number;
}

// -- Matchmaking ----------------------------------------------------------

/** Client -> server, join the matchmaking queue. */
export interface QueueJoinMessage {
  type: 'queue:join';
}

/** Client -> server, leave the matchmaking queue. */
export interface QueueLeaveMessage {
  type: 'queue:leave';
}

/** Server -> client, sent instead of queuing while matchmaking-banned. */
export interface QueueBannedMessage {
  type: 'queue:banned';
  bannedUntil: number;
}

/** Server -> both matched players, transition out of the queue. */
export interface MatchFoundMessage {
  type: 'match:found';
  opponentName: string;
  timeMode: TimeMode;
}

// -- Private rooms ----------------------------------------------------------

/** Client -> server, create a private room. */
export interface RoomCreateMessage {
  type: 'room:create';
  timeMode: TimeMode;
  themeMode: ThemeMode;
}

/** Server -> creator, with the room's shareable code. */
export interface RoomCreatedMessage {
  type: 'room:created';
  code: number;
}

/** Client -> server, attempt to join an existing room by code. */
export interface RoomJoinMessage {
  type: 'room:join';
  code: number;
}

/** Server -> both players, once a second player joins a room. */
export interface RoomJoinedMessage {
  type: 'room:joined';
  code: number;
  opponentName: string;
  timeMode: TimeMode;
  themeMode: ThemeMode;
}

/** Server -> the joining client only, when `room:join` fails. */
export interface RoomErrorMessage {
  type: 'room:error';
  reason: RoomErrorReason;
}

/** Server -> the remaining player, opponent is gone. */
export interface RoomPlayerLeftMessage {
  type: 'room:playerLeft';
}

/** Server -> whichever player(s) are still connected, terminal room
 * message. */
export interface RoomClosedMessage {
  type: 'room:closed';
  reason: RoomClosedReason;
}

// -- Theme voting (private rooms with `themeMode: 'chosen'`) --------------

/** Server -> both players, a 10s countdown to pick a theme. */
export interface VoteStartMessage {
  type: 'vote:start';
  themeIds: ThemeId[];
  endsAt: number;
}

/** Client -> server, cast (or re-cast) a vote. */
export interface VoteCastMessage {
  type: 'vote:cast';
  themeId: ThemeId;
}

/** Server -> the other player, live relay of an accepted vote. */
export interface VoteOpponentChoiceMessage {
  type: 'vote:opponentChoice';
  themeId: ThemeId;
}

/** Server -> both players, once voting's `endsAt` elapses. */
export interface VoteSettledMessage {
  type: 'vote:settled';
  themeId: ThemeId;
  agreed: boolean;
}

// -- Quit -------------------------------------------------------------------

/** Client -> server, explicit leave (also synthesized server-side on an
 * unexpected socket close). */
export interface PlayerQuitMessage {
  type: 'player:quit';
}

// -- Unions -----------------------------------------------------------------

/** Messages this client ever sends to the server. */
export type ClientMessage =
  | IdentifyMessage
  | QueueJoinMessage
  | QueueLeaveMessage
  | RoomCreateMessage
  | RoomJoinMessage
  | RoundProgressMessage
  | RoundSubmitMessage
  | VoteCastMessage
  | PlayerQuitMessage;

/** Messages this client ever receives from the server. */
export type ServerMessage =
  | IdentifyAckMessage
  | QueueBannedMessage
  | MatchFoundMessage
  | RoundStartMessage
  | RoundProgressMessage
  | RoundTimeWarningMessage
  | RoundRevealMessage
  | RoundNextMatchMessage
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomErrorMessage
  | RoomPlayerLeftMessage
  | RoomClosedMessage
  | VoteStartMessage
  | VoteOpponentChoiceMessage
  | VoteSettledMessage;
