/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Multiplayer WebSocket server URL. See `.env.example`. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
