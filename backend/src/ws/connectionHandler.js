// WebSocket connection lifecycle: parses each incoming text frame as a
// flat `{ type, ...payload }` envelope (see PROTOCOL.md "Transport") and
// dispatches it to whichever handler has been registered for that
// `type` via registerHandler(). Matchmaking, rooms, and the session
// engine own their own message types and register into this dispatcher
// from their own files (backend/src/matchmaking/, backend/src/rooms/)
// instead of this file growing a god-switch.
//
// The registry (registry.js) is the source of truth for which socket
// belongs to which playerId. This file owns wiring a socket into that
// registry on `identify` and tearing it down on close; it does not know
// anything about matches, rooms, or queues beyond that.

import { WebSocket } from 'ws';
import { registerSocket, unregisterSocket, getPlayerId } from './registry.js';

const handlers = new Map();
const disconnectSubscribers = new Set();

/**
 * Registers a handler function for a given message `type`. Called by
 * this file (for `identify`) and by other modules that want to handle
 * their own message types without editing this file's dispatch loop.
 * `fn(socket, message)` is invoked with the parsed message envelope.
 */
export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

/**
 * Subscribes to socket disconnects. `cb(playerId)` fires once a socket
 * that had identified as `playerId` closes, after it has already been
 * removed from the registry. Lets matchmaking/rooms react (ban table,
 * `room:playerLeft`, ...) without this file knowing about matches or
 * rooms. Returns an unsubscribe function.
 */
export function onDisconnect(cb) {
  disconnectSubscribers.add(cb);
  return () => disconnectSubscribers.delete(cb);
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'error', message }));
  }
}

registerHandler('identify', (socket, message) => {
  const { playerId, name } = message;
  if (typeof playerId !== 'string' || playerId.length === 0) {
    sendError(socket, 'identify requires a string playerId');
    return;
  }
  if (typeof name !== 'string' || name.length === 0) {
    sendError(socket, 'identify requires a string name');
    return;
  }
  registerSocket(playerId, socket, name);
  socket.send(JSON.stringify({ type: 'identify:ack' }));
});

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    sendError(socket, 'Malformed JSON');
    return;
  }

  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
    sendError(socket, 'Message must be an object with a string "type" field');
    return;
  }

  // Per PROTOCOL.md "Identity": no message is valid before `identify`.
  if (getPlayerId(socket) === undefined && message.type !== 'identify') {
    socket.close(1008, 'identify required');
    return;
  }

  const handler = handlers.get(message.type);
  if (!handler) {
    sendError(socket, `Unknown message type: ${message.type}`);
    return;
  }

  try {
    handler(socket, message);
  } catch (err) {
    console.error(`handler for "${message.type}" threw:`, err);
    sendError(socket, `Internal error handling ${message.type}`);
  }
}

export function handleConnection(socket) {
  socket.on('message', (raw) => handleMessage(socket, raw));

  socket.on('close', () => {
    const playerId = unregisterSocket(socket);
    if (playerId === undefined) return;
    for (const cb of disconnectSubscribers) {
      cb(playerId);
    }
  });
}
