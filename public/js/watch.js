// ===== VIEWER LOGIC =====

const params = new URLSearchParams(window.location.search);
const roomId = (params.get('room') || '').toUpperCase();
const userName = (params.get('name') || '').trim();

// Sem nome válido (ex.: link compartilhado direto): manda para a home com o código preenchido
let redirectTo = null;
if (!/^[A-Z0-9]{6}$/.test(roomId)) {
  redirectTo = '/';
} else if (!hasMinNameLetters(userName)) {
  redirectTo = `/?room=${roomId}`;
}

const socket = io({ autoConnect: false });

const DISCONNECT_GRACE = 5000;
const RECOVERY_INTERVAL = 10000;
const MAX_RECOVERY_ATTEMPTS = 5;

// State
let peerConnection = null;
let currentSession = null;
let pendingCandidates = []; // { candidate, session }
let broadcasterSocketId = null;
let broadcasterOnline = false;
let streaming = false;
let hasEnded = false;
let wasConnected = false;
let disconnectTimer = null;
let recoveryTimer = null;
let recoveryAttempts = 0;
let controlsTimeout = null;

// DOM refs
const remoteVideo = document.getElementById('remote-video');
const waitingScreen = document.getElementById('waiting-screen');
const waitingSpinner = document.getElementById('waiting-spinner');
const waitingTitle = document.getElementById('waiting-title');
const waitingMsg = document.getElementById('waiting-msg');
const waitingBack = document.getElementById('waiting-back');
const videoWrapper = document.getElementById('video-wrapper');
const watchLayout = document.getElementById('watch-layout');
const watchControls = document.getElementById('watch-controls');
const watchInfo = document.getElementById('watch-info');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const btnMute = document.getElementById('btn-mute');
const btnPip = document.getElementById('btn-pip');
const btnUsers = document.getElementById('btn-users');
const unmuteBanner = document.getElementById('unmute-banner');
const watchSidebar = document.getElementById('watch-sidebar');
const userList = document.getElementById('user-list');
const viewerCountEl = document.getElementById('viewer-count');
const broadcasterLabel = document.getElementById('broadcaster-label');
const liveBadge = document.getElementById('live-badge');
const qualityInfo = document.getElementById('quality-info');
const endedOverlay = document.getElementById('ended-overlay');

// ===== SCREEN STATES =====
function showWaiting(title, message, { spinner = true, back = false } = {}) {
  waitingTitle.textContent = title;
  waitingMsg.textContent = message || '';
  waitingSpinner.hidden = !spinner;
  waitingBack.hidden = !back;
  waitingScreen.hidden = false;
  videoWrapper.hidden = true;
  liveBadge.hidden = true;
  unmuteBanner.hidden = true;
  showControls();
}

function showVideo() {
  waitingScreen.hidden = true;
  videoWrapper.hidden = false;
  liveBadge.hidden = false;
  resetControlsTimeout();
}

// ===== AUTO-HIDE CONTROLS =====
function showControls() {
  watchControls.classList.add('visible');
  watchInfo.classList.add('visible');
  document.body.style.cursor = '';
}

function resetControlsTimeout() {
  showControls();
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    // Só esconde com o vídeo na tela, sem a sidebar aberta e sem foco nos controles
    if (videoWrapper.hidden || watchSidebar.classList.contains('open') || watchControls.contains(document.activeElement)) {
      return;
    }
    watchControls.classList.remove('visible');
    watchInfo.classList.remove('visible');
    document.body.style.cursor = 'none';
  }, 3000);
}

watchLayout.addEventListener('mousemove', resetControlsTimeout);
watchLayout.addEventListener('touchstart', resetControlsTimeout, { passive: true });
watchControls.addEventListener('focusin', resetControlsTimeout);

// ===== VOLUME CONTROLS =====
const savedVolume = parseInt(storageGet('localStorage', 'ss-volume'), 10);
let lastVolume = Number.isFinite(savedVolume) && savedVolume > 0 ? Math.min(savedVolume, 100) : 100;

function renderVolume() {
  const shown = remoteVideo.muted ? 0 : Math.round(remoteVideo.volume * 100);
  volumeSlider.value = shown;
  volumeValue.textContent = shown + '%';
  setIcon(btnMute.querySelector('.icon'), shown === 0 ? 'volume-x' : 'volume');
  btnMute.setAttribute('aria-label', shown === 0 ? 'Ativar som' : 'Silenciar');
  volumeSlider.style.background = `linear-gradient(to right, #fff ${shown}%, rgba(255, 255, 255, 0.2) ${shown}%)`;
}

function setVolume(value) {
  value = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  remoteVideo.volume = value / 100;
  remoteVideo.muted = value === 0;
  if (value > 0) {
    lastVolume = value;
    unmuteBanner.hidden = true;
  }
  storageSet('localStorage', 'ss-volume', String(value));
  renderVolume();
}

function toggleMute() {
  if (remoteVideo.muted || remoteVideo.volume === 0) {
    setVolume(lastVolume || 100);
  } else {
    remoteVideo.muted = true;
    renderVolume();
  }
}

volumeSlider.addEventListener('input', () => setVolume(volumeSlider.value));
btnMute.addEventListener('click', toggleMute);

// Initialize volume
setVolume(Number.isFinite(savedVolume) ? savedVolume : 100);

// ===== AUTOPLAY =====
// Navegadores bloqueiam autoplay com som sem interação: cai para mudo e pede um clique
async function playVideo() {
  try {
    await remoteVideo.play();
  } catch (e) {
    if (e.name !== 'NotAllowedError') return;
    remoteVideo.muted = true;
    renderVolume();
    unmuteBanner.hidden = false;
    try {
      await remoteVideo.play();
    } catch (err) {
      console.warn('Autoplay blocked even when muted:', err);
    }
  }
}

unmuteBanner.addEventListener('click', () => {
  setVolume(lastVolume || 100);
  remoteVideo.play().catch(() => {});
  unmuteBanner.hidden = true;
});

// ===== PIP =====
if (!document.pictureInPictureEnabled) {
  btnPip.hidden = true;
}

async function togglePiP() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (remoteVideo.readyState >= 2) {
      await remoteVideo.requestPictureInPicture();
    } else {
      showToast('Aguarde o vídeo carregar', 'info');
    }
  } catch (e) {
    console.error('PiP error:', e);
    showToast('PiP não disponível', 'error');
  }
}

btnPip.addEventListener('click', togglePiP);

// ===== FULLSCREEN =====
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (watchLayout.requestFullscreen) {
    watchLayout.requestFullscreen().catch(() => showToast('Tela cheia não disponível', 'error'));
  } else if (remoteVideo.webkitEnterFullscreen) {
    // iOS Safari
    remoteVideo.webkitEnterFullscreen();
  }
}

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

// ===== SIDEBAR =====
function toggleSidebar() {
  const isOpen = watchSidebar.classList.toggle('open');
  btnUsers.classList.toggle('active', isOpen);
  btnUsers.setAttribute('aria-expanded', String(isOpen));
  resetControlsTimeout();
}

btnUsers.addEventListener('click', toggleSidebar);
document.getElementById('btn-close-sidebar').addEventListener('click', toggleSidebar);

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;

  switch (e.key.toLowerCase()) {
    case 'm': toggleMute(); break;
    case 'f': toggleFullscreen(); break;
    case 'p': if (!btnPip.hidden) togglePiP(); break;
    case 'escape': if (watchSidebar.classList.contains('open')) toggleSidebar(); break;
    default: return;
  }
  resetControlsTimeout();
});

// ===== DISPLAY QUALITY INFO =====
function displayQualitySettings(settings) {
  if (!settings) {
    qualityInfo.hidden = true;
    return;
  }
  qualityInfo.textContent = formatSettings(settings);
  qualityInfo.hidden = false;
}

// ===== CONNECTION RECOVERY =====
function stopRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

// Se a conexão não sair em alguns segundos, pede uma nova offer ao broadcaster
function scheduleRecovery() {
  stopRecovery();
  recoveryTimer = setTimeout(() => {
    if (hasEnded || !streaming || !broadcasterOnline) return;
    if (peerConnection && peerConnection.connectionState === 'connected') return;

    recoveryAttempts++;
    if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
      showWaiting(
        'Não foi possível conectar',
        'Sua rede pode estar bloqueando a conexão direta. Tente outra rede ou recarregue a página.',
        { spinner: false, back: true }
      );
      return;
    }
    socket.emit('request-offer');
    scheduleRecovery();
  }, RECOVERY_INTERVAL);
}

function requestRecovery() {
  showWaiting('Reconectando...', 'A conexão com a transmissão caiu');
  socket.emit('request-offer');
  scheduleRecovery();
}

// ===== WEBRTC =====
function closePeer() {
  clearTimeout(disconnectTimer);
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
}

function createPeerConnection(config, session) {
  const pc = new RTCPeerConnection(config);

  pc.onicecandidate = (event) => {
    if (event.candidate && broadcasterSocketId) {
      socket.emit('ice-candidate', { to: broadcasterSocketId, candidate: event.candidate, session });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc !== peerConnection) return;
    const state = pc.connectionState;
    console.log('[Viewer] Connection state:', state);
    clearTimeout(disconnectTimer);

    if (state === 'connected') {
      stopRecovery();
      recoveryAttempts = 0;
      showVideo();
      if (!wasConnected) showToast('Conectado à transmissão!', 'success');
      wasConnected = true;
    } else if (state === 'disconnected') {
      showToast('Conexão instável...', 'warning');
      disconnectTimer = setTimeout(() => {
        if (pc === peerConnection && pc.connectionState !== 'connected') requestRecovery();
      }, DISCONNECT_GRACE);
    } else if (state === 'failed') {
      requestRecovery();
    }
  };

  // Receive stream
  pc.ontrack = (event) => {
    console.log('[Viewer] Received track:', event.track.kind, event.track.label);

    let stream = event.streams[0];
    if (!stream) {
      stream = remoteVideo.srcObject instanceof MediaStream ? remoteVideo.srcObject : new MediaStream();
      stream.addTrack(event.track);
    }

    if (remoteVideo.srcObject !== stream) {
      remoteVideo.srcObject = stream;
    }
    playVideo();
  };

  return pc;
}

// Receive offer from broadcaster
socket.on('offer', async ({ from, offer, session }) => {
  if (hasEnded) return;
  broadcasterSocketId = from;
  closePeer();
  currentSession = session;
  pendingCandidates = pendingCandidates.filter(c => c.session === session);

  try {
    const config = await getIceConfig();
    if (currentSession !== session) return; // chegou uma offer mais nova

    const pc = createPeerConnection(config, session);
    peerConnection = pc;

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    const localAnswer = { type: answer.type, sdp: enableStereoOpus(answer.sdp) };
    await pc.setLocalDescription(localAnswer);
    if (pc !== peerConnection) return;

    socket.emit('answer', { to: from, answer: localAnswer, session });

    // Add any pending ICE candidates that arrived before the offer
    const pending = pendingCandidates;
    pendingCandidates = [];
    for (const { candidate } of pending) {
      await pc.addIceCandidate(candidate).catch(e => console.warn('Error adding ICE candidate:', e));
    }

    scheduleRecovery();
  } catch (e) {
    console.error('Error handling offer:', e);
    requestRecovery();
  }
});

// ICE candidate from broadcaster
socket.on('ice-candidate', async ({ candidate, session }) => {
  if (!candidate) return;

  if (peerConnection && session === currentSession && peerConnection.remoteDescription) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (e) {
      console.warn('Error adding ICE candidate:', e);
    }
  } else if (currentSession == null || session >= currentSession) {
    // Queue candidates until remote description is set
    pendingCandidates.push({ candidate, session });
  }
});

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
  if (hasEnded) return;
  waitingMsg.textContent = 'Entrando na sala...';

  socket.emit('join-room', { roomId, name: userName }, (response) => {
    if (!response || response.error) {
      const error = (response && response.error) || 'Erro ao entrar na sala';
      showWaiting(error, 'Confira o código com quem está transmitindo.', { spinner: false, back: true });
      socket.disconnect();
      return;
    }

    broadcasterLabel.textContent = response.broadcasterName;
    document.title = `ScreenShare — ${response.broadcasterName}`;
    broadcasterOnline = response.broadcasterOnline;
    streaming = response.streaming;
    displayQualitySettings(response.qualitySettings);

    if (!broadcasterOnline) {
      showWaiting('Aguardando quem vai transmitir', 'A transmissão começa assim que a pessoa entrar na sala');
    } else if (!streaming) {
      showWaiting('Aguardando a transmissão', 'A sala está aberta, mas a tela ainda não foi compartilhada');
    } else if (!peerConnection || peerConnection.connectionState !== 'connected') {
      showWaiting('Conectando à transmissão...', 'Estabelecendo conexão direta com quem transmite');
      scheduleRecovery();
    }
  });
});

socket.on('disconnect', (reason) => {
  if (!hasEnded && reason !== 'io client disconnect') {
    showToast('Conexão com o servidor perdida, reconectando...', 'warning');
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

// Broadcaster started/stopped sharing
socket.on('stream-state', ({ streaming: isStreaming }) => {
  streaming = isStreaming;
  broadcasterOnline = true;

  if (!streaming) {
    closePeer();
    stopRecovery();
    remoteVideo.srcObject = null;
    wasConnected = false;
    showWaiting('Transmissão pausada', 'A tela deixou de ser compartilhada. Aguarde que ela volte.');
  } else if (!peerConnection || peerConnection.connectionState !== 'connected') {
    showWaiting('Conectando à transmissão...', 'Estabelecendo conexão direta com quem transmite');
    recoveryAttempts = 0;
    scheduleRecovery();
  }
});

// Broadcaster perdeu a conexão com o servidor (pode voltar)
socket.on('broadcaster-disconnected', () => {
  broadcasterOnline = false;
  stopRecovery();
  showToast('Quem transmite perdeu a conexão. Aguardando retorno...', 'warning');
});

socket.on('broadcaster-reconnected', () => {
  broadcasterOnline = true;
  showToast('A transmissão voltou', 'success');
});

// Broadcaster left
socket.on('broadcaster-left', () => {
  hasEnded = true;
  closePeer();
  stopRecovery();
  remoteVideo.srcObject = null;
  endedOverlay.hidden = false;
  showControls();
  socket.disconnect();
});

// Handle page leave
window.addEventListener('pagehide', () => {
  closePeer();
  socket.disconnect();
});

// Start
if (redirectTo) {
  window.location.replace(redirectTo);
} else {
  showWaiting('Conectando à transmissão...', 'Entrando na sala...');
  socket.connect();
}
