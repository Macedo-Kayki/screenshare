// ===== BROADCASTER LOGIC =====

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const userName = params.get('name') || 'Broadcaster';

if (!roomId) {
  window.location.href = '/';
}

const socket = io();

// State
let stream = null;
let peerConnections = new Map();
let viewers = new Set(); // Track all viewer IDs
let currentSettings = {
  resolution: '720p',
  fps: 30,
  bitrate: 'medium'
};

// DOM refs
const preview = document.getElementById('preview');
const placeholder = document.getElementById('placeholder');
const liveBadge = document.getElementById('live-badge');
const qualityBadge = document.getElementById('quality-badge');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const roomCodeEl = document.getElementById('room-code');
const userList = document.getElementById('user-list');
const viewerCountEl = document.getElementById('viewer-count');

// Set room code
roomCodeEl.textContent = roomId;

// Update quality badge
function updateQualityBadge() {
  qualityBadge.textContent = `${currentSettings.resolution} · ${currentSettings.fps}fps · ${QUALITY_PRESETS[currentSettings.bitrate].label}`;
  qualityBadge.style.display = '';
}

// ===== CAPTURE SCREEN =====
async function startBroadcast() {
  try {
    const res = RESOLUTION_PRESETS[currentSettings.resolution];

    // Step 1: Capture screen with audio
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: currentSettings.fps }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 2 // Request stereo audio
      },
      // Prefer sharing a tab to get audio by default
      preferCurrentTab: false,
      selfBrowserSurface: 'include',
      systemAudio: 'include',
      surfaceSwitching: 'include'
    });

    // Check if audio was captured from screen share
    const hasDisplayAudio = stream.getAudioTracks().length > 0;

    if (hasDisplayAudio) {
      showToast('Tela + áudio capturados em alta qualidade!', '🔊');
    } else {
      // No audio from display — try to capture system audio separately
      showToast('Áudio do sistema não disponível. Compartilhe uma aba do Chrome para incluir áudio.', '⚠️');
    }

    preview.srcObject = stream;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
    liveBadge.style.display = '';
    updateQualityBadge();
    btnStart.style.display = 'none';
    btnStop.style.display = '';

    // Handle stream end
    stream.getVideoTracks()[0].onended = () => {
      stopBroadcast();
    };

    // Send quality settings to server so new viewers get it
    socket.emit('quality-changed', { roomId, settings: currentSettings });

    // Close any existing peer connections to start fresh
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();

    // Create offers for all known viewers
    for (const viewerId of viewers) {
      const pc = await createPeerConnection(viewerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: viewerId, offer });
    }

  } catch (err) {
    console.error('Capture error:', err);
    if (err.name !== 'NotAllowedError') {
      showToast('Erro ao capturar tela', '❌');
    }
  }
}

function stopBroadcast() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  preview.srcObject = null;
  preview.style.display = 'none';
  placeholder.style.display = '';
  liveBadge.style.display = 'none';
  qualityBadge.style.display = 'none';
  btnStart.style.display = '';
  btnStop.style.display = 'none';

  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();

  showToast('Transmissão encerrada', '⏹️');
}

// ===== WEBRTC PEER CONNECTION =====
async function createPeerConnection(viewerId) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peerConnections.set(viewerId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: viewerId,
        candidate: event.candidate
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[Peer ${viewerId}] ICE state: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      pc.close();
      peerConnections.delete(viewerId);
    }
  };

  if (stream) {
    addStreamToPeer(pc, viewerId);
  }

  return pc;
}

function addStreamToPeer(pc, viewerId) {
  if (!stream) return;

  // Remove existing senders
  pc.getSenders().forEach(sender => {
    try { pc.removeTrack(sender); } catch(e) {}
  });

  // Add ALL tracks (video + audio)
  stream.getTracks().forEach(track => {
    console.log(`[Peer] Adding track: ${track.kind} (${track.label})`);
    pc.addTrack(track, stream);
  });

  applyBitrateToConnection(pc);
}

async function applyBitrateToConnection(pc) {
  const preset = QUALITY_PRESETS[currentSettings.bitrate];

  pc.getSenders().forEach(async (sender) => {
    if (sender.track && sender.track.kind === 'video') {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = preset.maxBitrate;
      try {
        await sender.setParameters(params);
      } catch (e) {
        console.warn('Could not set video bitrate:', e);
      }
    }
    if (sender.track && sender.track.kind === 'audio') {
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 256000; // 256 kbps for high quality stereo audio
      try {
        await sender.setParameters(params);
      } catch (e) {
        console.warn('Could not set audio bitrate:', e);
      }
    }
  });
}

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
  socket.emit('broadcaster-join', { roomId, name: userName }, (response) => {
    if (response.success) {
      console.log('[Broadcaster] Joined room:', roomId);
      // Send initial quality settings
      socket.emit('quality-changed', { roomId, settings: currentSettings });
    }
  });
});

// New viewer wants to connect
socket.on('viewer-joined', async ({ id, name }) => {
  showToast(`${name} entrou na sala`, '👋');
  viewers.add(id);

  if (stream) {
    const pc = await createPeerConnection(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: id, offer });
  }
});

// Viewer sends answer
socket.on('answer', async ({ from, answer }) => {
  const pc = peerConnections.get(from);
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) {
      console.error('Error setting answer:', e);
    }
  }
});

// ICE candidate from viewer
socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections.get(from);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  }
});

// Viewer left
socket.on('viewer-left', ({ id, name }) => {
  showToast(`${name} saiu da sala`, '👋');
  viewers.delete(id);
  const pc = peerConnections.get(id);
  if (pc) {
    pc.close();
    peerConnections.delete(id);
  }
});

// Room users update
socket.on('room-users', async (users) => {
  updateUserList(userList, users, viewerCountEl);

  // Sync viewers set
  users.forEach(async (user) => {
    if (user.role === 'viewer') {
      viewers.add(user.id);
      // If transmitting and we don't have a PC for them, create and offer
      if (stream && !peerConnections.has(user.id)) {
        const pc = await createPeerConnection(user.id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { to: user.id, offer });
      }
    }
  });
});

// ===== QUALITY CONTROLS =====
function setResolution(res) {
  currentSettings.resolution = res;
  updateToggle('resolution-toggle', res);
  updateQualityBadge();
  applyConstraints();
  socket.emit('quality-changed', { roomId, settings: currentSettings });
}

function setFPS(fps) {
  currentSettings.fps = fps;
  updateToggle('fps-toggle', String(fps));
  updateQualityBadge();
  applyConstraints();
  socket.emit('quality-changed', { roomId, settings: currentSettings });
}

function setBitrate(preset) {
  currentSettings.bitrate = preset;
  updateToggle('bitrate-toggle', preset);
  updateQualityBadge();
  peerConnections.forEach(pc => applyBitrateToConnection(pc));
  socket.emit('quality-changed', { roomId, settings: currentSettings });
}

function updateToggle(groupId, activeValue) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeValue);
  });
}

async function applyConstraints() {
  if (!stream) return;

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;

  const res = RESOLUTION_PRESETS[currentSettings.resolution];

  try {
    await videoTrack.applyConstraints({
      width: { ideal: res.width },
      height: { ideal: res.height },
      frameRate: { ideal: currentSettings.fps }
    });
  } catch (e) {
    console.warn('Could not apply constraints:', e);
  }
}

// ===== UTILITIES =====
function copyRoomCode() {
  copyToClipboard(roomId);
}

function toggleFullscreen() {
  const container = document.getElementById('video-container');
  if (!document.fullscreenElement) {
    container.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

window.addEventListener('beforeunload', () => {
  stopBroadcast();
  socket.disconnect();
});
