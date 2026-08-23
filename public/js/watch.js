// ===== VIEWER LOGIC =====

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const userName = params.get('name') || 'Espectador';

if (!roomId) {
  window.location.href = '/';
}

const socket = io();

// State
let peerConnection = null;
let isMuted = false;
let controlsTimeout = null;
let pendingCandidates = [];

// DOM refs
const remoteVideo = document.getElementById('remote-video');
const waitingScreen = document.getElementById('waiting-screen');
const waitingMsg = document.getElementById('waiting-msg');
const videoWrapper = document.getElementById('video-wrapper');
const watchLayout = document.getElementById('watch-layout');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const btnMute = document.getElementById('btn-mute');
const watchSidebar = document.getElementById('watch-sidebar');
const userList = document.getElementById('user-list');
const viewerCountEl = document.getElementById('viewer-count');
const broadcasterLabel = document.getElementById('broadcaster-label');
const qualityInfo = document.getElementById('quality-info');
const endedOverlay = document.getElementById('ended-overlay');

// ===== AUTO-HIDE CONTROLS =====
function resetControlsTimeout() {
  const controls = document.getElementById('watch-controls');
  const info = document.getElementById('watch-info');
  controls.classList.add('visible');
  info.classList.add('visible');
  document.body.style.cursor = 'default';

  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    if (!watchSidebar.classList.contains('open')) {
      controls.classList.remove('visible');
      info.classList.remove('visible');
      document.body.style.cursor = 'none';
    }
  }, 3000);
}

watchLayout.addEventListener('mousemove', resetControlsTimeout);
watchLayout.addEventListener('touchstart', resetControlsTimeout);

// ===== VOLUME CONTROLS =====
function setVolume(value) {
  remoteVideo.volume = value / 100;
  volumeValue.textContent = value + '%';
  volumeSlider.value = value;

  if (value == 0) {
    btnMute.textContent = '🔇';
    isMuted = true;
  } else {
    btnMute.textContent = '🔊';
    isMuted = false;
  }

  const pct = value + '%';
  volumeSlider.style.background = `linear-gradient(to right, var(--accent-primary) ${pct}, var(--bg-tertiary) ${pct})`;
}

function toggleMute() {
  if (isMuted) {
    remoteVideo.muted = false;
    setVolume(volumeSlider._lastVolume || 100);
    isMuted = false;
  } else {
    volumeSlider._lastVolume = volumeSlider.value;
    remoteVideo.muted = true;
    setVolume(0);
    isMuted = true;
  }
}

// Initialize slider background
setVolume(100);

// ===== PIP =====
async function togglePiP() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (remoteVideo.readyState >= 2) {
      await remoteVideo.requestPictureInPicture();
      showToast('Picture-in-Picture ativado', '🖼️');
    } else {
      showToast('Aguarde o vídeo carregar', '⏳');
    }
  } catch (e) {
    console.error('PiP error:', e);
    showToast('PiP não disponível', '❌');
  }
}

// ===== FULLSCREEN =====
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    watchLayout.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

// ===== SIDEBAR =====
function toggleSidebar() {
  watchSidebar.classList.toggle('open');
  const btn = document.getElementById('btn-users');
  btn.classList.toggle('active');
}

// ===== DISPLAY QUALITY INFO =====
function displayQualitySettings(settings) {
  if (!settings) {
    qualityInfo.style.display = 'none';
    return;
  }
  const bitrateLabel = { low: 'Baixa', medium: 'Média', high: 'Alta' };
  const label = `${settings.resolution} · ${settings.fps}fps · ${bitrateLabel[settings.bitrate] || ''}`;
  qualityInfo.textContent = label;
  qualityInfo.style.display = '';
}

// ===== WEBRTC =====
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(ICE_SERVERS);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: broadcasterSocketId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('[Viewer] ICE state:', peerConnection.iceConnectionState);

    if (peerConnection.iceConnectionState === 'connected') {
      waitingScreen.style.display = 'none';
      videoWrapper.style.display = 'block';
      showToast('Conectado à transmissão!', '📡');
      resetControlsTimeout();
    }

    if (peerConnection.iceConnectionState === 'disconnected') {
      showToast('Conexão instável...', '⚠️');
    }

    if (peerConnection.iceConnectionState === 'failed') {
      showToast('Conexão perdida', '❌');
    }
  };

  // Receive stream
  peerConnection.ontrack = (event) => {
    console.log('[Viewer] Received track:', event.track.kind, event.track.label);
    
    let stream = event.streams[0];
    if (!stream) {
      stream = new MediaStream();
      stream.addTrack(event.track);
    }

    if (remoteVideo.srcObject !== stream) {
      remoteVideo.srcObject = stream;
      // Ensure volume is applied
      remoteVideo.volume = volumeSlider.value / 100;
      remoteVideo.muted = isMuted;
    }
  };

  return peerConnection;
}

let broadcasterSocketId = null;

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
  waitingMsg.textContent = 'Entrando na sala...';

  socket.emit('join-room', { roomId, name: userName }, (response) => {
    if (response.error) {
      waitingMsg.textContent = response.error;
      showToast(response.error, '❌');
      return;
    }

    broadcasterLabel.textContent = response.broadcasterName;
    document.title = `ScreenShare — ${response.broadcasterName}`;
    waitingMsg.textContent = 'Aguardando stream...';
    showToast('Conectado à sala!', '✅');

    // Display initial quality settings from server
    if (response.qualitySettings) {
      displayQualitySettings(response.qualitySettings);
    } else {
      qualityInfo.style.display = 'none';
    }
  });
});

// Receive offer from broadcaster
socket.on('offer', async ({ from, offer }) => {
  broadcasterSocketId = from;

  if (peerConnection) {
    peerConnection.close();
  }
  createPeerConnection();

  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', { to: from, answer });

    // Add any pending ICE candidates that arrived before the offer
    pendingCandidates.forEach(candidate => {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
    });
    pendingCandidates = [];

  } catch (e) {
    console.error('Error handling offer:', e);
    showToast('Erro na conexão', '❌');
  }
});

// ICE candidate from broadcaster
socket.on('ice-candidate', async ({ from, candidate }) => {
  if (peerConnection && peerConnection.remoteDescription) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  } else {
    // Queue candidates until remote description is set
    pendingCandidates.push(candidate);
  }
});

// Room users update
socket.on('room-users', (users) => {
  updateUserList(userList, users, viewerCountEl);
});

// Quality changed by broadcaster
socket.on('quality-changed', (settings) => {
  displayQualitySettings(settings);
});

// Broadcaster left
socket.on('broadcaster-left', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  endedOverlay.style.display = 'block';
  showToast('Transmissão encerrada pelo broadcaster', '📡');
});

// Handle page leave
window.addEventListener('beforeunload', () => {
  if (peerConnection) peerConnection.close();
  socket.disconnect();
});

// Start controls timeout
resetControlsTimeout();
