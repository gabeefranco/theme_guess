# rooms/

Numeric-code private rooms: `room.js` tracks live rooms (code -> room
state), handles `room:create`/`room:join`, and replays
`game/session.js` matches up to a 5-match cap unless a player quits.
Implemented; theme voting for `themeMode: 'chosen'` rooms is ticket #7.
