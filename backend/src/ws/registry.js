// In-memory bidirectional registry mapping the client-generated
// `playerId` (see PROTOCOL.md "Identity") to the live WebSocket for that
// player, and back. Other backend modules (matchmaking, rooms, ...) use
// this to look up "the socket for player X" to send targeted messages,
// and connectionHandler.js uses it to look up "the playerId for this
// socket" on disconnect for cleanup.

import { WebSocket } from 'ws';

const socketsByPlayerId = new Map();
const playerIdsBySocket = new Map();

/**
 * Registers a socket under a playerId. If that playerId was already
 * bound to a different (stale) socket, the stale binding is dropped
 * first so the registry never points a playerId at a dead socket.
 */
export function registerSocket(playerId, socket) {
  const existingSocket = socketsByPlayerId.get(playerId);
  if (existingSocket && existingSocket !== socket) {
    playerIdsBySocket.delete(existingSocket);
  }
  socketsByPlayerId.set(playerId, socket);
  playerIdsBySocket.set(socket, playerId);
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
