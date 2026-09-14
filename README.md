# Theme Guess

A browser game about syntax-highlighting themes. A snippet of code is
rendered with every token type (keywords, strings, functions, variables,
comments, ...) in a neutral color. You click a token, every token of that
same kind lights up together, and you pick a color for it — repeat until
the whole file is themed. Reveal shows how close your from-scratch palette
landed to a real theme (Gruvbox, Tokyo Night, VS Code Dark+, GitHub Dark,
Dracula, Catppuccin), token kind by token kind.

The project is moving from a single-player-only page toward supporting
**multiplayer matchmaking** (race another player to the closest match on
the same theme/snippet). This repo is split into a frontend game client
and a backend matchmaking/realtime server so that work can land
independently.

## Layout

```
frontend/   Canvas game client: Vite + TypeScript, no UI framework.
backend/    Matchmaking + realtime session server: Node, HTTP + WebSocket.
```

Each package has its own `package.json`, dependencies, and scripts — see
`frontend/README.md`-equivalent notes below and `backend/src/*/README.md`
for what's reserved but not implemented yet.

## Running the frontend

```sh
cd frontend
npm install
npm run dev       # Vite dev server with HMR
npm run build     # type-check + production bundle to dist/
npm run typecheck # tsc --noEmit only
```

## Running the backend

```sh
cd backend
npm install
npm start         # node src/index.js
npm run dev       # same, with --watch
```

Boots a plain HTTP server (with a `/health` check) and attaches a
WebSocket server to it. Matchmaking and room/session logic are not
implemented yet — see `backend/src/matchmaking/README.md` and
`backend/src/rooms/README.md`.

## Deployment

The frontend (static Vite build) and backend (persistent Node
HTTP+WebSocket process) deploy independently and to different kinds of
host.

**Frontend on Netlify:** the root `netlify.toml` builds from
`frontend/` (`npm run build`, publish `frontend/dist`). Point this site
at your deployed backend by setting `VITE_WS_URL` under Site settings
-> Environment variables (or `netlify env:set VITE_WS_URL
wss://your-backend-host`) — it's read at build time by
`frontend/src/net/client.ts`. Use `wss://`, not `ws://`: once the
Netlify site is served over https, a plain `ws://` socket is blocked as
mixed content (the client warns in the console if this is
misconfigured). See `frontend/.env.example`.

**Backend:** Netlify doesn't run long-lived Node processes, so
`backend/` needs a real host (Fly.io, Render, Railway, a VPS, ...) that
can keep a WebSocket server alive. It listens on `process.env.PORT`
(see `backend/src/index.js`), which most such hosts set automatically;
override it manually if yours doesn't. Whatever host/port it ends up
on, put that address into the frontend's `VITE_WS_URL` above.

## Status

Single-player game: playable. Multiplayer: backend is a bare HTTP+WS
scaffold with no matchmaking logic yet; frontend has no multiplayer UI
yet. See `AGENTS.md` for architecture notes and contribution conventions.
