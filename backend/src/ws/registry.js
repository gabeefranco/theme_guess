// In-memory bidirectional registry mapping the client-generated
// `playerId` (see PROTOCOL.md "Identity") to the live WebSocket for that
// player, and back, plus the player's last-known display `name` (also
// sent on `identify`). Other backend modules (matchmaking, rooms, ...)
// use this to look up "the socket for player X" (or "the name for
// player X", e.g. for `match:found.opponentName` /
// `room:joined.opponentName`) to send targeted messages, and
// connectionHandler.js uses it to look up "the playerId for this
// socket" on disconnect for cleanup.
const socketsByPlayerId = new Map();
const playerIdsBySocket = new Map();
// Names persist across reconnects (keyed by the client-generated
// playerId, which is stable per PROTOCOL.md "Identity"), so a socket
// dropping does not erase who a still-waiting/queued opponent is.
const namesByPlayerId = new Map();

/**
 * Registers a socket under a playerId, optionally recording/updating its
 * display name (from `identify`). If that playerId was already bound to
 * a different (stale) socket, the stale binding is dropped first so the
 * registry never points a playerId at a dead socket.
 */
export function registerSocket(playerId, socket, name) {
  const existingSocket = socketsByPlayerId.get(playerId);
  if (existingSocket && existingSocket !== socket) {
    playerIdsBySocket.delete(existingSocket);
  }
  socketsByPlayerId.set(playerId, socket);
  playerIdsBySocket.set(socket, playerId);
  if (typeof name === 'string' && name.length > 0) {
    namesByPlayerId.set(playerId, name);
  }
}

/**
 * Removes a socket's registration. Returns the playerId that was bound
 * to it, or undefined if the socket was never registered (e.g. it
 * disconnected before sending `identify`).
 */
export function unregisterSocket(socket) {
  const playerId = playerIdsBySocket.get(socket);
  if (playerId === undefined) return undefined;
  playerIdsBySocket.delete(socket);
  if (socketsByPlayerId.get(playerId) === socket) {
    socketsByPlayerId.delete(playerId);
  }
  return playerId;
}

export function getSocket(playerId) {
  return socketsByPlayerId.get(playerId);
}

export function getPlayerId(socket) {
  return playerIdsBySocket.get(socket);
}

/**
 * Returns the last-known display name for playerId (set via `identify`),
 * or undefined if that playerId has never identified with a name.
 */
export function getPlayerName(playerId) {
  return namesByPlayerId.get(playerId);
}

/**
 * Sends a typed JSON message to the socket registered for playerId.
 * Returns true if the message was sent, false if there was no open
 * socket for that player (already disconnected, or never identified).
 */
export function sendTo(playerId, message) {
  const socket = socketsByPlayerId.get(playerId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}
