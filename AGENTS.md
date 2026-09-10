# AGENTS.md

Context and working agreements for anyone (human or agent) changing this
repo. See `README.md` for what the product is; this file is about how we
build it.

## Architecture

`frontend/` (Vite + TypeScript, **no UI framework** — plain DOM) is
layered bottom-up; each layer only imports from the ones below it:

```
types.ts        shared domain types (Token, CategoryState, ThemeDefinition, ...)
data/           static content: theme palettes, code samples
engine/         pure, DOM-free utilities: tokenizer, color math, particles, sound
game/           canvas rendering, scoring, panel/result DOM views, ThemeGuessGame
preview/        the pre-round "flash the real theme" renderer
ui/             composable DOM widgets (theme grid, preview countdown flow)
main.ts         composition root — wires the above to the page, nothing else
```

New game logic goes in `engine/` if it doesn't touch the DOM, `game/` if
it does. Don't reach for React/Vue/etc.: the canvas rendering and the
handful of DOM widgets don't need a framework, and adding one is a
bigger discussion than a drive-by PR.

`backend/` is currently a bare HTTP+WebSocket bootstrap
(`src/index.js` + `src/ws/connectionHandler.js`) with `src/matchmaking/`
and `src/rooms/` reserved but empty (see the `README.md` in each). Plain
Node with ESM (`"type": "module"`), no framework, no TypeScript — keep it
that way until there's an actual reason to add one.

## Code style

- Frontend TypeScript runs under `strict`. Don't widen types to work
  around an error without understanding why it's there.
- Small static string-keyed lookup tables are `Record<K, V>`, not `Set`/
  `Map` — reach for `Set`/`Map` only for dynamic membership, non-string
  keys, or when you need `.size`/iteration order/`.clear()`.
- Don't wrap a single expression in a named function just to name it,
  unless the name is a stable public API, a callback whose identity
  matters, or documents a non-obvious formula. Inline the rest.
- A property literally named `constructor` in an object literal typed as
  `Record<string, V>` gets its value type silently widened by TS (see
  `engine/tokenizer.ts`'s `toLookup`) — build such tables from an array
  via `Object.fromEntries` instead of a literal when a key might collide.

## Git

- Trunk is `main`; keep it green (typechecks, builds, game loads).
- One short-lived branch per change, prefixed by intent:
  `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`.
- Commit messages follow Conventional Commits:
  `type(scope): summary` — e.g. `refactor(frontend): split game into modules`,
  `feat(backend): add matchmaking queue`. Scope is usually `frontend`,
  `backend`, or a package-relative area (`engine`, `ui`, `ws`, ...).
- Squash-merge feature branches into `main`; delete the branch after.
  Keep history readable — no "wip", "fix typo", "asdf" commits on `main`.
- Frontend and backend evolve independently; a PR touching only one
  should only bump/discuss that package's version and deps.

## Verification expectations

- Frontend change: `npm run typecheck` (or `build`) in `frontend/`, plus
  an actual smoke test (open the dev server, play a round) for anything
  touching rendering, input, or scoring — type-checking alone doesn't
  catch a canvas drawn one line too high.
- Backend change: whatever's implemented must actually boot
  (`npm start`) and the touched transport (HTTP route / WS message) must
  be exercised manually or with a script; there's no test suite yet.
