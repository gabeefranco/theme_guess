# matchmaking/

Pairs waiting players FIFO-style, randomly assigns per-match timeMode
(2 or 4 minutes, never player-chosen) and theme, and enforces the
2-minute matchmaking quit ban — see `queue.js` and
`../PROTOCOL.md`'s "Matchmaking" and "Quit" sections. Party/lobby
handling beyond a single 1v1 queue is not implemented.
