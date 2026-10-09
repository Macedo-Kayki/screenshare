// ===== BROADCASTER LOGIC =====

const params = new URLSearchParams(window.location.search);
const roomId = (params.get('room') || '').toUpperCase();
const userName = params.get('name') || 'Broadcaster';

const isValidRoom = /^[A-Z0-9]{6}$/.test(roomId);
if (!isValidRoom) {
  window.location.replace('/');
}

// Token da sala: sessionStorage (padrão) ou hash da URL (fallback sem storage)
const tokenKey = `ss-token-${roomId}`;
let roomToken = storageGet('sessionStorage', tokenKey);
const hashToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
if (hashToken) {
  roomToken = hashToken;
  storageSet('sessionStorage', tokenKey, hashToken);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

const socket = io({ autoConnect: false });

const STATS_INTERVAL = 2000;
const DISCONNECT_GRACE = 5000;
const MAX_RETRIES = 5;

// State
let stream = null;
// viewerId -> { pc, session, pendingCandidates, disconnectTimer, createdAt, lastBytes, lastTimestamp, statsText }
const peers = new Map();
const viewers = new Set(); // Track all viewer IDs
const retries = new Map();
let sessionCounter = 0;
let maxViewers = null;
let isFatal = false;
let currentSettings = loadSettings();

// DOM refs
const preview = document.getElementById('preview');
const placeholder = document.getElementById('placeholder');
const liveBadge = document.getElementById('live-badge');
const qualityBadge = document.getElementById('quality-badge');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnSwitch = document.getElementById('btn-switch');
const roomCodeEl = document.getElementById('room-code');
const userList = document.getElementById('user-list');
const viewerCountEl = document.getElementById('viewer-count');
const dockStatus = document.getElementById('dock-status');

// Set room code
roomCodeEl.textContent = roomId;

// ===== SETTINGS =====
function loadSettings() {
  const defaults = { resolution: '720p', fps: 30, bitrate: 'medium', content: 'detail' };
  try {
    const saved = JSON.parse(storageGet('localStorage', 'ss-broadcast-settings') || '{}');
    if (RESOLUTION_PRESETS[saved.resolution]) defaults.resolution = saved.resolution;
    if ([15, 30, 60].includes(saved.fps)) defaults.fps = saved.fps;
    if (QUALITY_PRESETS[saved.bitrate]) defaults.bitrate = saved.bitrate;
    if (CONTENT_PRESETS[saved.content]) defaults.content = saved.content;
  } catch (e) {
    // ignore corrupted settings
  }
  return defaults;
}

function updateQualityBadge() {
  qualityBadge.textContent = formatSettings(currentSettings);
}

function updateToggle(groupId, activeValue) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-option').forEach(btn => {
    const isActive = btn.dataset.value === String(activeValue);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function renderSettings() {
  updateToggle('resolution-toggle', currentSettings.resolution);
  updateToggle('fps-toggle', currentSettings.fps);
  updateToggle('bitrate-toggle', currentSettings.bitrate);
  updateToggle('content-toggle', currentSettings.content);
  updateQualityBadge();
}

function setSetting(key, rawValue) {
  const value = key === 'fps' ? parseInt(rawValue, 10) : rawValue;
  if (currentSettings[key] === value) return;
  currentSettings[key] = value;

  renderSettings();
  storageSet('localStorage', 'ss-broadcast-settings', JSON.stringify(currentSettings));
  socket.emit('quality-changed', { settings: currentSettings });

  if (key === 'resolution' || key === 'fps') applyConstraints();
  if (key === 'content') applyContentHint();
  peers.forEach(peer => peer.pc && applyEncodingParams(peer.pc));
}

document.querySelectorAll('.toggle-group[data-setting]').forEach(group => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-option');
    if (btn) setSetting(group.dataset.setting, btn.dataset.value);
  });
});

renderSettings();

function setDockStatus(isLive) {
  dockStatus.classList.toggle('is-live', isLive);
  dockStatus.textContent = isLive ? 'Transmitindo' : 'Fora do ar';
}

// ===== CAPTURE SCREEN =====
function captureScreen() {
  const res = RESOLUTION_PRESETS[currentSettings.resolution];
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: res.width, max: res.width },
      height: { ideal: res.height, max: res.height },
      frameRate: { ideal: currentSettings.fps, max: currentSettings.fps }
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 2 // Request stereo audio
    },
    preferCurrentTab: false,
    // Evita o efeito "espelho infinito" ao compartilhar a própria aba
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include'
  });
}

async function startBroadcast() {
  if (stream || isFatal) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast('Seu navegador não suporta compartilhamento de tela', 'error');
    return;
  }

  btnStart.disabled = true;
  try {
    const captured = await captureScreen();

    if (isFatal) {
      captured.getTracks().forEach(track => track.stop());
      return;
    }
    stream = captured;
    applyContentHint();

    // Check if audio was captured from screen share
    if (stream.getAudioTracks().length > 0) {
      showToast('Tela + áudio capturados!', 'success');
    } else {
      showToast('Transmitindo sem áudio. Compartilhe uma aba e marque "Compartilhar áudio" para incluir som.', 'warning');
    }

    preview.srcObject = stream;
    preview.hidden = false;
    placeholder.hidden = true;
    liveBadge.hidden = false;
    setDockStatus(true);
    qualityBadge.hidden = false;
    btnStart.hidden = true;
    btnStop.hidden = false;
    btnSwitch.hidden = false;

    // Handle stream end (usuário clicou em "Parar compartilhamento" do navegador)
    stream.getVideoTracks()[0].addEventListener('ended', () => stopBroadcast());

    socket.emit('quality-changed', { settings: currentSettings });
    socket.emit('stream-state', { streaming: true });

    // Create offers for all known viewers
    closeAllPeers();
    viewers.forEach(viewerId => connectToViewer(viewerId));
  } catch (err) {
    console.error('Capture error:', err);
    if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      showToast('Erro ao capturar tela', 'error');
    }
  } finally {
    btnStart.disabled = false;
  }
}

function stopBroadcast({ silent = false } = {}) {
  if (!stream) return;

  stream.getTracks().forEach(track => track.stop());
  stream = null;

  preview.srcObject = null;
  preview.hidden = true;
  placeholder.hidden = false;
  liveBadge.hidden = true;
  setDockStatus(false);
  qualityBadge.hidden = true;
  btnStart.hidden = false;
  btnStop.hidden = true;
  btnSwitch.hidden = true;

  closeAllPeers();
  socket.emit('stream-state', { streaming: false });

  if (!silent) showToast('Transmissão encerrada', 'info');
}

// Troca a fonte compartilhada sem derrubar as conexões existentes
async function switchScreen() {
  if (!stream || isFatal) return;

  btnSwitch.disabled = true;
  let next;
  try {
    next = await captureScreen();
  } catch (err) {
    // Usuário cancelou o seletor: mantém a tela atual
    if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      console.error('Switch error:', err);
      showToast('Erro ao trocar de tela', 'error');
    }
    btnSwitch.disabled = false;
    return;
  }

  if (isFatal || !stream) {
    next.getTracks().forEach(track => track.stop());
    btnSwitch.disabled = false;
    return;
  }

  const previous = stream;
  const hadAudio = previous.getAudioTracks().length > 0;
  const hasAudio = next.getAudioTracks().length > 0;
  const newVideo = next.getVideoTracks()[0];
  const newAudio = next.getAudioTracks()[0] || null;

  stream = next;
  applyContentHint();
  preview.srcObject = stream;
  newVideo.addEventListener('ended', () => stopBroadcast());

  if (hadAudio !== hasAudio) {
    // Ganhou ou perdeu áudio: o número de faixas mudou, então renegocia
    closeAllPeers();
    viewers.forEach(viewerId => connectToViewer(viewerId));
  } else {
    // Mesma composição de faixas: troca no lugar, sem renegociar (instantâneo)
    for (const peer of peers.values()) {
      if (!peer.pc) continue;
      for (const sender of peer.pc.getSenders()) {
        if (!sender.track) continue;
        if (sender.track.kind === 'video') {
          await sender.replaceTrack(newVideo).catch(e => console.warn('replace video track:', e));
        } else if (sender.track.kind === 'audio' && newAudio) {
          await sender.replaceTrack(newAudio).catch(e => console.warn('replace audio track:', e));
        }
      }
      applyEncodingParams(peer.pc);
    }
  }

  previous.getTracks().forEach(track => track.stop());
  showToast(hasAudio ? 'Tela trocada, com áudio' : 'Tela trocada', 'success');
  btnSwitch.disabled = false;
}

function applyContentHint() {
  if (!stream) return;
  const preset = CONTENT_PRESETS[currentSettings.content];
  stream.getVideoTracks().forEach(track => {
    if ('contentHint' in track) track.contentHint = preset.hint;
  });
}

async function applyConstraints() {
  if (!stream) return;

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;

  const res = RESOLUTION_PRESETS[currentSettings.resolution];

  try {
    await videoTrack.applyConstraints({
      width: { ideal: res.width, max: res.width },
      height: { ideal: res.height, max: res.height },
      frameRate: { ideal: currentSettings.fps, max: currentSettings.fps }
    });
  } catch (e) {
    console.warn('Could not apply constraints:', e);
  }
}

// ===== WEBRTC PEER CONNECTION =====
function closePeer(viewerId) {
  const peer = peers.get(viewerId);
  if (!peer) return;
  clearTimeout(peer.disconnectTimer);
  if (peer.pc) peer.pc.close();
  peers.delete(viewerId);
}

function closeAllPeers() {
  Array.from(peers.keys()).forEach(closePeer);
}

// Cria (ou recria) a conexão com um espectador e envia a offer
async function connectToViewer(viewerId) {
  if (!stream) return;
  closePeer(viewerId);

  // Cada conexão tem um número de sessão: respostas/candidatos antigos são ignorados
  const peer = {
    pc: null,
    session: ++sessionCounter,
    pendingCandidates: [],
    disconnectTimer: null,
    createdAt: Date.now(),
    lastBytes: null,
    lastTimestamp: null,
    statsText: ''
  };
  peers.set(viewerId, peer);

  const config = await getIceConfig();
  if (peers.get(viewerId) !== peer || !stream) return; // superseded while loading config

  const pc = new RTCPeerConnection(config);
  peer.pc = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: viewerId, candidate: event.candidate, session: peer.session });
    }
  };

  pc.onconnectionstatechange = () => {
    if (peers.get(viewerId) !== peer) return;
    const state = pc.connectionState;
    console.log(`[Peer ${viewerId}] connection state: ${state}`);
    clearTimeout(peer.disconnectTimer);

    if (state === 'connected') {
      retries.delete(viewerId);
    } else if (state === 'disconnected') {
      // "disconnected" costuma ser passageiro: espera antes de recriar
      peer.disconnectTimer = setTimeout(() => {
        if (peers.get(viewerId) === peer && pc.connectionState !== 'connected') scheduleReconnect(viewerId);
      }, DISCONNECT_GRACE);
    } else if (state === 'failed') {
      scheduleReconnect(viewerId);
    }
  };

  addTracksToPeer(pc);

  try {
    const offer = await pc.createOffer();
    const localOffer = { type: offer.type, sdp: enableStereoOpus(offer.sdp) };
    await pc.setLocalDescription(localOffer);
    if (peers.get(viewerId) !== peer) return;
    socket.emit('offer', { to: viewerId, offer: localOffer, session: peer.session });
  } catch (e) {
    console.error('Error creating offer:', e);
    scheduleReconnect(viewerId);
  }
}

function scheduleReconnect(viewerId) {
  if (!stream || !viewers.has(viewerId)) return;
  const attempt = (retries.get(viewerId) || 0) + 1;
  if (attempt > MAX_RETRIES) {
    closePeer(viewerId);
    setViewerStats(viewerId, 'sem conexão');
    showToast('Não foi possível conectar a um espectador (rede bloqueada?)', 'warning');
    return;
  }
  retries.set(viewerId, attempt);
  setTimeout(() => {
    if (stream && viewers.has(viewerId)) connectToViewer(viewerId);
  }, Math.min(1000 * attempt, 5000));
}

function addTracksToPeer(pc) {
  const preset = QUALITY_PRESETS[currentSettings.bitrate];

  stream.getVideoTracks().forEach(track => {
    const transceiver = pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [{ maxBitrate: preset.maxBitrate, maxFramerate: currentSettings.fps }]
    });
    preferVideoCodecs(transceiver);
  });

  stream.getAudioTracks().forEach(track => {
    pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [{ maxBitrate: AUDIO_MAX_BITRATE }]
    });
  });

  applyEncodingParams(pc);
}

async function applyEncodingParams(pc) {
  const preset = QUALITY_PRESETS[currentSettings.bitrate];
  const content = CONTENT_PRESETS[currentSettings.content];

  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const sendParams = sender.getParameters();
    if (!sendParams.encodings || !sendParams.encodings.length) continue;

    if (sender.track.kind === 'video') {
      sendParams.encodings[0].maxBitrate = preset.maxBitrate;
      sendParams.encodings[0].maxFramerate = currentSettings.fps;
      sendParams.degradationPreference = content.degradation;
    } else {
      sendParams.encodings[0].maxBitrate = AUDIO_MAX_BITRATE;
    }

    try {
      await sender.setParameters(sendParams);
    } catch (e) {
      console.warn(`Could not set ${sender.track.kind} parameters:`, e);
    }
  }
}

// ===== CONNECTION STATS =====
function setViewerStats(viewerId, text) {
  const peer = peers.get(viewerId);
  if (peer) peer.statsText = text;
  const el = userList.querySelector(`[data-user-id="${CSS.escape(viewerId)}"] .user-stats`);
  if (el) el.textContent = text;
}

async function collectStats() {
  for (const [viewerId, peer] of peers) {
    if (!peer.pc || peer.pc.connectionState !== 'connected') {
      if (peer.pc) setViewerStats(viewerId, 'conectando...');
      continue;
    }

    let report;
    try {
      report = await peer.pc.getStats();
    } catch (e) {
      continue;
    }

    let video = null;
    let rtt = null;
    report.forEach(s => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') video = s;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated && s.currentRoundTripTime != null) {
        rtt = s.currentRoundTripTime;
      }
    });
    if (!video) continue;

    const parts = [];
    if (peer.lastBytes != null && video.timestamp > peer.lastTimestamp) {
      const kbps = ((video.bytesSent - peer.lastBytes) * 8) / (video.timestamp - peer.lastTimestamp);
      parts.push(kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`);
    }
    peer.lastBytes = video.bytesSent;
    peer.lastTimestamp = video.timestamp;

    if (video.framesPerSecond != null) parts.push(`${Math.round(video.framesPerSecond)} fps`);
    if (rtt != null) parts.push(`${Math.round(rtt * 1000)} ms`);
    if (video.qualityLimitationReason === 'bandwidth') parts.push('limitado pela rede');
    if (video.qualityLimitationReason === 'cpu') parts.push('limitado pela CPU');

    if (parts.length) setViewerStats(viewerId, parts.join(' · '));
  }
}

setInterval(collectStats, STATS_INTERVAL);

// ===== FATAL ERRORS =====
function showFatal(message) {
  isFatal = true;
  stopBroadcast({ silent: true });
  document.getElementById('error-msg').textContent = message;
  document.getElementById('error-overlay').hidden = false;
  btnStart.disabled = true;
}

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
  if (isFatal) return;
  if (!roomToken) {
    showFatal('Sessão de transmissão não encontrada. Crie uma nova sala na página inicial.');
    socket.disconnect();
    return;
  }

  socket.emit('broadcaster-join', { roomId, name: userName, token: roomToken }, (response) => {
    if (!response || response.error) {
      showFatal((response && response.error) || 'Erro ao entrar na sala');
      socket.disconnect();
      return;
    }
    console.log('[Broadcaster] Joined room:', roomId);
    maxViewers = response.maxViewers || null;
    socket.emit('quality-changed', { settings: currentSettings });
    socket.emit('stream-state', { streaming: !!stream });
  });
});

socket.on('disconnect', (reason) => {
  if (!isFatal && reason !== 'io client disconnect') {
    showToast('Conexão com o servidor perdida, reconectando...', 'warning');
  }
});

// Sala aberta em outra aba
socket.on('session-replaced', () => {
  showFatal('Esta sala foi aberta em outra aba ou janela.');
  socket.disconnect();
});

// New viewer wants to connect
socket.on('viewer-joined', ({ id, name }) => {
  showToast(`${name} entrou na sala`, 'join');
  viewers.add(id);
  if (stream && !peers.has(id)) connectToViewer(id);
});

// Viewer pede uma nova conexão (falha do lado dele)
socket.on('request-offer', ({ from }) => {
  if (!stream || !viewers.has(from)) return;
  const peer = peers.get(from);
  // Já há uma conexão recente sendo estabelecida: não recria
  if (peer && Date.now() - peer.createdAt < DISCONNECT_GRACE &&
      (!peer.pc || ['new', 'connecting'].includes(peer.pc.connectionState))) {
    return;
  }
  connectToViewer(from);
});

// Viewer sends answer
socket.on('answer', async ({ from, answer, session }) => {
  const peer = peers.get(from);
  if (!peer || !peer.pc || peer.session !== session) return;
  if (peer.pc.signalingState !== 'have-local-offer') return;

  try {
    await peer.pc.setRemoteDescription(answer);
    const pending = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const candidate of pending) {
      await peer.pc.addIceCandidate(candidate).catch(e => console.warn('Error adding ICE candidate:', e));
    }
  } catch (e) {
    console.error('Error setting answer:', e);
  }
});

// ICE candidate from viewer
socket.on('ice-candidate', async ({ from, candidate, session }) => {
  const peer = peers.get(from);
  if (!peer || !peer.pc || peer.session !== session || !candidate) return;

  if (!peer.pc.remoteDescription) {
    peer.pendingCandidates.push(candidate);
    return;
  }
  try {
    await peer.pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn('Error adding ICE candidate:', e);
  }
});

// Viewer left
socket.on('viewer-left', ({ id, name }) => {
  showToast(`${name} saiu da sala`, 'leave');
  viewers.delete(id);
  retries.delete(id);
  closePeer(id);
});

// Room users update
socket.on('room-users', (users) => {
  updateUserList(userList, users, viewerCountEl, maxViewers);

  // Sync viewers set
  const currentIds = new Set(users.filter(u => u.role === 'viewer').map(u => u.id));
  Array.from(viewers).forEach(id => {
    if (!currentIds.has(id)) {
      viewers.delete(id);
      closePeer(id);
    }
  });

  currentIds.forEach(id => {
    viewers.add(id);
    const peer = peers.get(id);
    if (peer && peer.statsText) setViewerStats(id, peer.statsText);
    // If transmitting and we don't have a PC for them, create and offer
    if (stream && !peer) connectToViewer(id);
  });
});

// ===== UI EVENTS =====
btnStart.addEventListener('click', startBroadcast);
btnStop.addEventListener('click', () => stopBroadcast());
btnSwitch.addEventListener('click', switchScreen);

document.getElementById('btn-copy-code').addEventListener('click', () => {
  copyToClipboard(roomId, 'Código copiado!');
});

document.getElementById('btn-copy-link').addEventListener('click', () => {
  copyToClipboard(getInviteLink(roomId), 'Link de convite copiado!');
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  const container = document.getElementById('video-container');
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (container.requestFullscreen) {
    container.requestFullscreen().catch(() => showToast('Tela cheia não disponível', 'error'));
  }
});

window.addEventListener('beforeunload', (e) => {
  if (stream) {
    // Pede confirmação antes de sair no meio da transmissão
    e.preventDefault();
    e.returnValue = '';
  }
});

window.addEventListener('pagehide', () => {
  if (stream) stream.getTracks().forEach(track => track.stop());
});

if (isValidRoom) socket.connect();
