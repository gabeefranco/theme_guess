import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handleConnection } from './ws/connectionHandler.js';

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// The WebSocket server shares the HTTP server's port via the upgrade
// handshake, so one process serves both plain HTTP and `ws://`.
const wss = new WebSocketServer({ server });
wss.on('connection', handleConnection);

server.listen(PORT, () => {
  console.log(`Matchmaking server listening on :${PORT}`);
});
