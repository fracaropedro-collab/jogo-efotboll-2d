/* ============================================================
   E-FOOTBALL 2D — Servidor autoritativo (modo Online 1v1)
   - Salas por código (S2D-XXXX)
   - Simulação 60 Hz no servidor (mesma física do navegador)
   - Snapshots 30 Hz para os clientes
   - Também serve os arquivos estáticos do jogo (index.html…)
   Uso:
     npm install
     node server.js            # porta padrão 3000 (ou PORT=xxxx)
     PORT=8080 node server.js
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('../shared/sim.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, '..');          // raiz do repositório (index.html etc.)
const TICK = 1 / 60;                                  // 60 Hz fixo
const SNAP_EVERY = 2;                                 // snapshot a cada 2 ticks → 30 Hz
const ROOM_IDLE_MS = 10 * 60 * 1000;                  // sala ociosa expira em 10 min

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.md':   'text/markdown; charset=utf-8'
};

/* ---------- estáticos (com proteção contra path traversal) ---------- */
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); res.end(); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const fp = path.normalize(path.join(ROOT, urlPath));
  if (fp !== ROOT && !fp.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

/* ---------- salas ---------- */
const rooms = new Map();   // code -> room
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  for (;;) {
    let c = 'S2D-';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
const defaultInput = () => ({ u: false, d: false, l: false, r: false, plant: false, kick: false, ela: false, pow: false });
const sanitizeInput = (i) => {
  const b = v => v === true;
  if (!i || typeof i !== 'object') return defaultInput();
  return { u: b(i.u), d: b(i.d), l: b(i.l), r: b(i.r), plant: b(i.plant), kick: b(i.kick), ela: b(i.ela), pow: b(i.pow) };
};
const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) { /* cliente caiu */ } };
const broadcast = (room, obj) => { for (const c of room.clients) if (c) send(c, obj); };

function createRoom() {
  const room = {
    code: genCode(),
    clients: [null, null],     // WebSocket de cada jogador (0 = criador, 1 = convidado)
    inputs: [defaultInput(), defaultInput()],
    match: null,
    started: false,
    overNotified: false,
    rematchVotes: new Set(),
    lastActivity: Date.now(),
    acc: 0, snapTick: 0, last: 0
  };
  rooms.set(room.code, room);
  return room;
}
function startOrResetMatch(room) {
  if (!room.match) {
    room.match = Sim.createMatch({
      mode: 'online',
      goalLimit: 5,
      matchTime: 180,
      allowedPUs: Sim.PU_TYPES.slice()
    });
  } else {
    room.match.reset({ goalLimit: 5, matchTime: 180 });
  }
  room.overNotified = false;
  room.rematchVotes.clear();
  room.started = true;
  room.inputs = [defaultInput(), defaultInput()];
  // a sim lê S.inputs por referência — aponta os inputs da sala para dentro da sim
  room.match.inputs[0] = room.inputs[0];
  room.match.inputs[1] = room.inputs[1];
  room.lastActivity = Date.now();
}
function seatOf(room, ws) {
  if (room.clients[0] === ws) return 0;
  if (room.clients[1] === ws) return 1;
  return -1;
}
function tryStart(room) {
  if (room.started) return;
  if (room.clients[0] && room.clients[1]) {
    startOrResetMatch(room);
    send(room.clients[0], { t: 'start', myId: 0, code: room.code });
    send(room.clients[1], { t: 'start', myId: 1, code: room.code });
    console.log(`[sala ${room.code}] partida iniciada`);
  }
}
function roomOf(ws) {
  const code = ws._roomCode;
  return code ? rooms.get(code) : null;
}
function removeClient(room, ws) {
  const seat = seatOf(room, ws);
  if (seat === -1) return;
  room.clients[seat] = null;
  const peer = room.clients[1 - seat];
  if (peer) send(peer, { t: 'peerLeft' });
  console.log(`[sala ${room.code}] jogador ${seat} saiu`);
  if (!room.clients[0] && !room.clients[1]) {
    rooms.delete(room.code);
    console.log(`[sala ${room.code}] sala encerrada (vazia)`);
  }
  room.lastActivity = Date.now();
}

/* ---------- laço de simulação (4 ms, passo fixo 60 Hz) ---------- */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // expira salas ociosas sem jogadores há muito tempo
    if (!room.clients[0] && !room.clients[1] && now - room.lastActivity > ROOM_IDLE_MS) {
      rooms.delete(room.code);
      continue;
    }
    if (!room.match) continue;
    if (!room.last) room.last = now;
    room.acc += (now - room.last) / 1000;
    room.last = now;
    if (room.acc > 0.25) room.acc = 0.25;             // não tenta "alcançar" muito tempo em saltos
    while (room.acc >= TICK) {
      room.match.step(TICK, null);
      room.acc -= TICK;
      room.snapTick++;
      if (room.snapTick % SNAP_EVERY === 0) {
        const snap = room.match.snapshot();
        const ev = room.match.events.splice(0, room.match.events.length);
        broadcast(room, { t: 'state', s: snap, ev });
      } else {
        room.match.events.length = 0;   // eventos só saem junto do snapshot (30 Hz)
      }
    }
    if (room.match.gameState === 'over' && !room.overNotified) {
      room.overNotified = true;
      console.log(`[sala ${room.code}] fim de partida`);
    }
  }
}, 4);

/* ---------- protocolo ---------- */
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'ping') { send(ws, { t: 'pong' }); return; }

    if (msg.t === 'create') {
      if (roomOf(ws)) return;                     // já está numa sala
      const room = createRoom();
      room.clients[0] = ws;
      ws._roomCode = room.code;
      send(ws, { t: 'created', code: room.code, myId: 0 });
      console.log(`[sala ${room.code}] criada`);
      return;
    }

    if (msg.t === 'join') {
      if (roomOf(ws)) return;
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
      const room = rooms.get(code);
      if (!room) { send(ws, { t: 'error', msg: 'Sala "' + code + '" não encontrada.' }); return; }
      if (room.clients[0] && room.clients[1]) { send(ws, { t: 'error', msg: 'Sala "' + code + '" já está cheia.' }); return; }
      const seat = room.clients[0] ? 1 : 0;
      room.clients[seat] = ws;
      ws._roomCode = room.code;
      room.lastActivity = Date.now();
      send(ws, { t: 'joined', code: room.code, myId: seat });
      console.log(`[sala ${room.code}] jogador ${seat} entrou`);
      tryStart(room);
      return;
    }

    const room = roomOf(ws);
    if (!room) return;
    const seat = seatOf(room, ws);
    if (seat === -1) return;
    room.lastActivity = Date.now();

    if (msg.t === 'input') {
      const inp = sanitizeInput(msg.i);
      const cur = room.inputs[seat];
      // níveis: substituição direta; bordas (ela/pow): acumula até a sim consumir
      cur.u = inp.u; cur.d = inp.d; cur.l = inp.l; cur.r = inp.r; cur.plant = inp.plant; cur.kick = inp.kick;
      cur.ela = cur.ela || inp.ela;
      cur.pow = cur.pow || inp.pow;
      return;
    }

    if (msg.t === 'rematch') {
      room.rematchVotes.add(seat);
      if (room.rematchVotes.size >= 2) {
        startOrResetMatch(room);
        send(room.clients[0], { t: 'start', myId: 0, code: room.code });
        send(room.clients[1], { t: 'start', myId: 1, code: room.code });
        console.log(`[sala ${room.code}] revanche`);
      }
      return;
    }
  });
  ws.on('close', () => {
    const room = roomOf(ws);
    if (room) removeClient(room, ws);
  });
  ws.on('error', () => { /* close cuidará da limpeza */ });
});

server.listen(PORT, () => {
  console.log('E-FOOTBALL 2D — servidor rodando em http://localhost:' + PORT);
  console.log('Abra no navegador (duas abas ou dois computadores) e crie/entre numa sala com o mesmo código.');
});
