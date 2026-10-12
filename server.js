const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_VIEWERS = parseInt(process.env.MAX_VIEWERS, 10) || 10;
const MAX_ROOMS_PER_SOCKET = 5;
// Tempo que uma sala recém-criada espera o broadcaster entrar
const ROOM_CLAIM_TIMEOUT = 60 * 1000;
// Tolerância para o broadcaster reconectar (F5, queda de rede) antes de encerrar a sala
const BROADCASTER_GRACE_PERIOD = 20 * 1000;

const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;
const MIN_NAME_LETTERS = 3;
const VALID_SETTINGS = {
  resolution: ['480p', '720p', '1080p'],
  fps: [15, 30, 60],
  bitrate: ['low', 'medium', 'high'],
  content: ['detail', 'motion']
};

const app = express();
const server = http.createServer(app);
// Sem CORS: o front é servido pelo próprio Express (mesma origem)
const io = new Server(server, {
  maxHttpBufferSize: 100 * 1024
});

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'display-capture=(self), geolocation=()');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ICE servers (STUN + TURN opcional via variáveis de ambiente)
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

  const turnUrls = (process.env.TURN_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
  if (turnUrls.length) {
    if (process.env.TURN_SECRET) {
      // Credenciais temporárias no padrão "TURN REST API" (coturn: use-auth-secret)
      const expiry = Math.floor(Date.now() / 1000) + 12 * 3600;
      const username = `${expiry}:screenshare`;
      const credential = crypto
        .createHmac('sha1', process.env.TURN_SECRET)
        .update(username)
        .digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({
        urls: turnUrls,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ iceServers });
});

// Store rooms
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

function sanitizeName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 30);
  // Mínimo de 3 letras (a home já bloqueia; aqui cobre clientes que pulam a validação)
  const letters = (clean.match(/\p{L}/gu) || []).length;
  return letters >= MIN_NAME_LETTERS ? clean : fallback;
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_CODE_REGEX.test(roomId);
}

function sanitizeSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const clean = {};
  for (const [key, allowed] of Object.entries(VALID_SETTINGS)) {
    if (!allowed.includes(settings[key])) return null;
    clean[key] = settings[key];
  }
  return clean;
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Callbacks vindos do cliente podem não existir ou não ser função
function safeCallback(callback) {
  return typeof callback === 'function' ? callback : () => {};
}

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const users = [];
  if (room.broadcaster) {
    users.push({ id: room.broadcaster, name: room.broadcasterName, role: 'broadcaster' });
  }
  room.viewers.forEach((name, id) => {
    users.push({ id, name, role: 'viewer' });
  });
  return users;
}

function destroyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(room.timer);
  io.to(roomId).emit('broadcaster-left');
  io.in(roomId).socketsLeave(roomId);
  rooms.delete(roomId);
  console.log(`[Room] Room ${roomId} destroyed`);
}

// Retorna a sala do socket se ele for o broadcaster atual dela
function getOwnedRoom(socket) {
  const { roomId, role } = socket.data;
  if (role !== 'broadcaster') return null;
  const room = rooms.get(roomId);
  if (!room || room.broadcaster !== socket.id) return null;
  return room;
}

// Só permite sinalização entre broadcaster e espectador da mesma sala
function canSignal(socket, to) {
  const { roomId, role } = socket.data;
  const room = rooms.get(roomId);
  if (!room || typeof to !== 'string') return false;
  if (role === 'broadcaster') {
    return room.broadcaster === socket.id && room.viewers.has(to);
  }
  if (role === 'viewer') {
    return room.viewers.has(socket.id) && room.broadcaster === to;
  }
  return false;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);
  socket.data.createdRooms = 0;

  // Broadcaster creates a room (from index page - just generates code + token)
  socket.on('create-room', (payload, callback) => {
    callback = safeCallback(callback);
    if (socket.data.createdRooms >= MAX_ROOMS_PER_SOCKET) {
      return callback({ error: 'Limite de salas atingido. Recarregue a página.' });
    }
    socket.data.createdRooms++;

    const name = sanitizeName(payload && payload.name, 'Broadcaster');
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();
    const token = crypto.randomBytes(24).toString('hex');

    rooms.set(code, {
      token,
      broadcaster: null,
      broadcasterName: name,
      viewers: new Map(),
      qualitySettings: null,
      streaming: false,
      // Remove a sala se o broadcaster nunca chegar a entrar
      timer: setTimeout(() => destroyRoom(code), ROOM_CLAIM_TIMEOUT)
    });

    callback({ roomId: code, token });
    console.log(`[Room] Created room ${code} for ${name}`);
  });

  // Broadcaster joins their room (from broadcast page) - requires the room token
  socket.on('broadcaster-join', (payload, callback) => {
    callback = safeCallback(callback);
    const { roomId, token } = payload || {};
    const room = isValidRoomId(roomId) ? rooms.get(roomId) : null;

    if (!room) {
      return callback({ error: 'Sala não encontrada ou expirada' });
    }
    if (!tokensMatch(token, room.token)) {
      return callback({ error: 'Você não tem permissão para transmitir nesta sala' });
    }

    clearTimeout(room.timer);
    room.timer = null;

    // Outra aba do mesmo broadcaster ainda conectada: ela perde o controle
    if (room.broadcaster && room.broadcaster !== socket.id) {
      const previous = io.sockets.sockets.get(room.broadcaster);
      if (previous) {
        previous.data.roomId = null;
        previous.leave(roomId);
        previous.emit('session-replaced');
      }
    }

    const wasAway = !room.broadcaster;
    room.broadcaster = socket.id;
    room.broadcasterName = sanitizeName(payload.name, room.broadcasterName);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'broadcaster';
    socket.data.name = room.broadcasterName;

    callback({ success: true, roomId, maxViewers: MAX_VIEWERS });

    if (wasAway) {
      socket.to(roomId).emit('broadcaster-reconnected', { name: room.broadcasterName });
    }
    io.to(roomId).emit('room-users', getRoomUsers(roomId));
    console.log(`[Room] Broadcaster ${room.broadcasterName} joined room ${roomId}`);
  });

  // Viewer joins a room
  socket.on('join-room', (payload, callback) => {
    callback = safeCallback(callback);
    const roomId = payload && payload.roomId;
    const room = isValidRoomId(roomId) ? rooms.get(roomId) : null;

    if (!room) {
      return callback({ error: 'Sala não encontrada' });
    }
    if (socket.data.roomId && rooms.has(socket.data.roomId)) {
      return callback({ error: 'Você já está em uma sala' });
    }
    if (room.viewers.size >= MAX_VIEWERS) {
      return callback({ error: `Sala cheia (máximo de ${MAX_VIEWERS} espectadores)` });
    }

    const name = sanitizeName(payload.name, 'Espectador');
    room.viewers.set(socket.id, name);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'viewer';
    socket.data.name = name;

    callback({
      success: true,
      broadcasterName: room.broadcasterName,
      broadcasterOnline: !!room.broadcaster,
      streaming: room.streaming,
      qualitySettings: room.qualitySettings
    });

    // Notify broadcaster about new viewer
    if (room.broadcaster) {
      io.to(room.broadcaster).emit('viewer-joined', { id: socket.id, name });
    }

    // Broadcast updated user list
    io.to(roomId).emit('room-users', getRoomUsers(roomId));

    console.log(`[Room] ${name} joined room ${roomId}`);
  });

  // WebRTC signaling (validated: only between broadcaster and its viewers)
  socket.on('offer', (payload) => {
    if (socket.data.role !== 'broadcaster' || !payload || !canSignal(socket, payload.to)) return;
    io.to(payload.to).emit('offer', { from: socket.id, offer: payload.offer, session: payload.session });
  });

  socket.on('answer', (payload) => {
    if (socket.data.role !== 'viewer' || !payload || !canSignal(socket, payload.to)) return;
    io.to(payload.to).emit('answer', { from: socket.id, answer: payload.answer, session: payload.session });
  });

  socket.on('ice-candidate', (payload) => {
    if (!payload || !canSignal(socket, payload.to)) return;
    io.to(payload.to).emit('ice-candidate', { from: socket.id, candidate: payload.candidate, session: payload.session });
  });

  // Viewer asks the broadcaster for a fresh connection (after a failure)
  socket.on('request-offer', () => {
    const room = rooms.get(socket.data.roomId);
    if (socket.data.role !== 'viewer' || !room || !room.broadcaster) return;
    io.to(room.broadcaster).emit('request-offer', { from: socket.id });
  });

  // Broadcaster quality settings changed - store AND relay
  socket.on('quality-changed', (payload) => {
    const room = getOwnedRoom(socket);
    const settings = sanitizeSettings(payload && payload.settings);
    if (!room || !settings) return;
    room.qualitySettings = settings;
    socket.to(socket.data.roomId).emit('quality-changed', settings);
  });

  // Broadcaster started/stopped sharing the screen
  socket.on('stream-state', (payload) => {
    const room = getOwnedRoom(socket);
    if (!room) return;
    room.streaming = !!(payload && payload.streaming);
    socket.to(socket.data.roomId).emit('stream-state', { streaming: room.streaming });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const { roomId, role, name } = socket.data;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'broadcaster' && room.broadcaster === socket.id) {
      // Dá um tempo para o broadcaster voltar antes de encerrar a sala
      room.broadcaster = null;
      room.streaming = false;
      io.to(roomId).emit('broadcaster-disconnected');
      io.to(roomId).emit('room-users', getRoomUsers(roomId));
      room.timer = setTimeout(() => destroyRoom(roomId), BROADCASTER_GRACE_PERIOD);
      console.log(`[Room] Broadcaster ${name} disconnected from room ${roomId}, waiting for reconnection`);
    } else if (role === 'viewer') {
      room.viewers.delete(socket.id);
      if (room.broadcaster) {
        io.to(room.broadcaster).emit('viewer-left', { id: socket.id, name });
      }
      io.to(roomId).emit('room-users', getRoomUsers(roomId));
      console.log(`[Room] Viewer ${name} left room ${roomId}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🖥️  ScreenShare Server running at http://localhost:${PORT}\n`);
});
