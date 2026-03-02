const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { nanoid } = require('nanoid');

const FRONTEND = path.join(__dirname, 'frontend', 'index.html');

const PORT = process.env.PORT || 3000;

/* rooms: Map<roomId, Set<ws>> */
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  /* POST /room — create a new room, return its ID */
  if (req.method === 'POST' && req.url === '/room') {
    const id = nanoid(8);
    rooms.set(id, new Set());
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id }));
    console.log(`[room] created ${id}`);
    return;
  }

  /* GET /health */
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  /* GET / — serve frontend */
  if (req.method === 'GET') {
    fs.readFile(FRONTEND, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  /* expect ws://host/room/:id */
  const match = req.url.match(/^\/room\/([^/?]+)/);
  if (!match) { ws.close(4000, 'missing room id'); return; }

  const roomId = match[1];

  /* auto-create room if opened directly via URL share */
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());

  const room = rooms.get(roomId);
  room.add(ws);
  ws._roomId = roomId;

  console.log(`[ws] joined ${roomId} (${room.size} peers)`);

  /* tell the newcomer how many peers are already in the room */
  send(ws, { type: 'room-info', peers: room.size - 1 });

  /* tell existing peers that someone new arrived */
  broadcast(room, ws, { type: 'peer-joined' });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    /* signaling messages: offer, answer, ice — relay to everyone else */
    if (['offer', 'answer', 'ice'].includes(msg.type)) {
      broadcast(room, ws, msg);
      return;
    }
  });

  ws.on('close', () => {
    room.delete(ws);
    console.log(`[ws] left ${roomId} (${room.size} peers)`);
    broadcast(room, ws, { type: 'peer-left' });

    /* clean up empty rooms */
    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`[room] removed ${roomId}`);
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(room, sender, obj) {
  const data = JSON.stringify(obj);
  for (const peer of room) {
    if (peer !== sender && peer.readyState === peer.OPEN) peer.send(data);
  }
}

server.listen(PORT, () => {
  console.log(`signaling server listening on :${PORT}`);
});
