// Placeholder connection handler. Matchmaking, room assignment, and
// game-state sync are not implemented yet — this only proves the
// WebSocket transport itself works end to end.

export function handleConnection(socket) {
  console.log('client connected');
  socket.on('close', () => console.log('client disconnected'));
}
