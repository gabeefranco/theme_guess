// Owns the single WebSocket connection to the multiplayer server. See
// backend/src/PROTOCOL.md for the wire contract this implements.

import { getOrCreatePlayerId, getPlayerName } from './identity';
import type { ClientMessage, ServerMessage } from './messages';

const DEFAULT_WS_URL = 'ws://localhost:8080';

/** `VITE_WS_URL` (see `frontend/.env.example`), defaulting to the local
 * dev backend. */
export const WS_URL = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;

/** Lifecycle of the underlying socket. `closed` covers both a clean
 * close and an error — reconnecting is out of scope here, callers that
 * care just need to know the connection is gone. */
export type ConnectionState = 'connecting' | 'open' | 'closed';

type ServerMessageOfType<K extends ServerMessage['type']> = Extract<ServerMessage, { type: K }>;
type MessageListener<K extends ServerMessage['type']> = (msg: ServerMessageOfType<K>) => void;
type Unsubscribe = () => void;

/** Thin wrapper around a browser `WebSocket` that speaks the theme-guess
 * protocol: sends `identify` as soon as the socket opens, and gives
 * callers a typed `send`/`on` API instead of hand-parsing `event.data`. */
export class GameClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'closed';
  private readonly listeners = new Map<string, Set<MessageListener<any>>>();
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();

  constructor(private readonly url: string = WS_URL) {}

  /** Opens the socket and sends `identify` once it's open. */
  connect(): void {
    this.setState('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.setState('open');
      this.send({ type: 'identify', playerId: getOrCreatePlayerId(), name: getPlayerName() });
    });
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
    socket.addEventListener('close', () => this.setState('closed'));
    socket.addEventListener('error', () => this.setState('closed'));
  }

  /** Closes the socket. No reconnect is attempted. */
  close(): void {
    this.socket?.close();
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Sends a typed protocol message as JSON. Throws if the socket isn't
   * open — callers should check `getState()` (or react to
   * `onStateChange`) before sending. */
  send<T extends ClientMessage>(msg: T): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('GameClient: cannot send, socket is not open');
    }
    this.socket.send(JSON.stringify(msg));
  }

  /** Subscribes to one server message type. Returns an unsubscribe
   * function. */
  on<K extends ServerMessage['type']>(type: K, cb: MessageListener<K>): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }

  /** Subscribes to connection lifecycle changes, e.g. to surface a
   * "connection lost" state in the UI. Returns an unsubscribe
   * function. */
  onStateChange(cb: (state: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const cb of this.stateListeners) cb(state);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    const set = this.listeners.get(msg.type);
    if (!set) return;
    for (const cb of set) cb(msg);
  }
}
