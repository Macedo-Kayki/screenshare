const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store rooms
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const users = [];
  if (room.broadcasterName) {
    users.push({ id: room.broadcaster, name: room.broadcasterName, role: 'broadcaster' });
  }
  room.viewers.forEach((name, id) => {
    users.push({ id, name, role: 'viewer' });
  });
  return users;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Broadcaster creates a room (from index page - just generates code)
  socket.on('create-room', ({ name }, callback) => {
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();

    rooms.set(code, {
      broadcaster: null,
      broadcasterName: name,
      viewers: new Map(),
      qualitySettings: null
    });

    callback({ roomId: code });
    console.log(`[Room] Created room ${code} for ${name}`);
  });

  // Broadcaster joins their room (from broadcast page)
  socket.on('broadcaster-join', ({ roomId, name }, callback) => {
    let room = rooms.get(roomId);

    if (!room) {
      rooms.set(roomId, {
        broadcaster: socket.id,
        broadcasterName: name,
        viewers: new Map(),
        qualitySettings: null
      });
      room = rooms.get(roomId);
    } else {
      room.broadcaster = socket.id;
      room.broadcasterName = name;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'broadcaster';
    socket.data.name = name;

    callback({ success: true, roomId });

    io.to(roomId).emit('room-users', getRoomUsers(roomId));
    console.log(`[Room] Broadcaster ${name} joined room ${roomId}`);
  });

  // Viewer joins a room
  socket.on('join-room', ({ roomId, name }, callback) => {
    const room = rooms.get(roomId);
    if (!room) {
      return callback({ error: 'Sala não encontrada' });
    }
    if (!room.broadcaster) {
      return callback({ error: 'O broadcaster não está mais na sala' });
    }

    room.viewers.set(socket.id, name);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'viewer';
    socket.data.name = name;

    // Send quality settings along with broadcaster name
    callback({
      success: true,
      broadcasterName: room.broadcasterName,
      qualitySettings: room.qualitySettings
    });

    // Notify broadcaster about new viewer
    io.to(room.broadcaster).emit('viewer-joined', { id: socket.id, name });

    // Broadcast updated user list
    io.to(roomId).emit('room-users', getRoomUsers(roomId));

    console.log(`[Room] ${name} joined room ${roomId}`);
  });

  // WebRTC signaling
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Broadcaster quality settings changed - store AND relay
  socket.on('quality-changed', ({ roomId, settings }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.qualitySettings = settings;
    }
    socket.to(roomId).emit('quality-changed', settings);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const { roomId, role, name } = socket.data;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'broadcaster') {
      io.to(roomId).emit('broadcaster-left');
      rooms.delete(roomId);
      console.log(`[Room] Broadcaster ${name} left, room ${roomId} destroyed`);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🖥️  ScreenShare Server running at http://localhost:${PORT}\n`);
});
