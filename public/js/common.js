// ===== COMMON UTILITIES =====

const FALLBACK_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const QUALITY_PRESETS = {
  low: { maxBitrate: 500000, label: 'Baixa' },
  medium: { maxBitrate: 1500000, label: 'Média' },
  high: { maxBitrate: 4000000, label: 'Alta' }
};

const RESOLUTION_PRESETS = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 }
};

// contentHint do track + preferência de degradação do encoder
const CONTENT_PRESETS = {
  detail: { hint: 'detail', degradation: 'maintain-resolution', label: 'Texto' },
  motion: { hint: 'motion', degradation: 'maintain-framerate', label: 'Movimento' }
};

// Ordem de preferência de codecs de vídeo (VP9/AV1 rendem melhor em conteúdo de tela)
const PREFERRED_VIDEO_CODECS = ['video/VP9', 'video/AV1', 'video/H264', 'video/VP8'];

const AUDIO_MAX_BITRATE = 256000;

// ICE servers vêm do servidor (inclui TURN quando configurado)
let iceConfigPromise = null;
function getIceConfig() {
  if (!iceConfigPromise) {
    iceConfigPromise = fetch('/api/ice-servers')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => (Array.isArray(data.iceServers) && data.iceServers.length ? data : FALLBACK_ICE_SERVERS))
      .catch(err => {
        console.warn('Could not load ICE servers, using fallback:', err);
        iceConfigPromise = null;
        return FALLBACK_ICE_SERVERS;
      });
  }
  return iceConfigPromise;
}

function showToast(message, icon = 'ℹ️') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  const iconEl = document.createElement('span');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const textEl = document.createElement('span');
  textEl.textContent = message;
  toast.append(iconEl, textEl);
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function getInitials(name) {
  const initials = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => Array.from(w)[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return initials || '?';
}

function createUserElement(user) {
  const li = document.createElement('li');
  li.className = 'user-item';
  li.dataset.userId = user.id;

  const avatar = document.createElement('div');
  avatar.className = 'user-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = getInitials(user.name);

  const info = document.createElement('div');
  info.className = 'user-info';

  const name = document.createElement('div');
  name.className = 'user-name';
  name.textContent = user.name;

  const role = document.createElement('div');
  role.className = 'user-role';
  role.textContent = user.role === 'broadcaster' ? '📡 Transmitindo' : '👁️ Assistindo';

  const stats = document.createElement('div');
  stats.className = 'user-stats';

  info.append(name, role, stats);
  li.append(avatar, info);
  return li;
}

function updateUserList(listElement, users, countElement, maxViewers) {
  listElement.replaceChildren(...users.map(createUserElement));
  if (countElement) {
    const viewerCount = users.filter(u => u.role === 'viewer').length;
    let text = `${viewerCount} espectador${viewerCount !== 1 ? 'es' : ''}`;
    if (maxViewers) text += ` (máx. ${maxViewers})`;
    countElement.textContent = text;
  }
}

function copyToClipboard(text, message = 'Copiado!') {
  const done = () => showToast(message, '📋');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const input = document.createElement('input');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand('copy');
    done();
  } catch (e) {
    showToast('Não foi possível copiar', '❌');
  }
  document.body.removeChild(input);
}

function getInviteLink(roomId) {
  return `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
}

function formatSettings(settings) {
  if (!settings) return '';
  const parts = [settings.resolution, `${settings.fps}fps`];
  if (QUALITY_PRESETS[settings.bitrate]) parts.push(QUALITY_PRESETS[settings.bitrate].label);
  if (CONTENT_PRESETS[settings.content]) parts.push(CONTENT_PRESETS[settings.content].label);
  return parts.join(' · ');
}

// localStorage/sessionStorage podem falhar (modo privado, bloqueio de cookies)
function storageGet(storage, key) {
  try {
    return window[storage].getItem(key);
  } catch (e) {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    window[storage].setItem(key, value);
  } catch (e) {
    // ignore
  }
}

// ===== WEBRTC HELPERS =====

function preferVideoCodecs(transceiver) {
  if (!transceiver.setCodecPreferences || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
  const capabilities = RTCRtpReceiver.getCapabilities('video');
  if (!capabilities) return;

  const rank = (codec) => {
    const index = PREFERRED_VIDEO_CODECS.indexOf(codec.mimeType);
    return index === -1 ? PREFERRED_VIDEO_CODECS.length : index;
  };
  const codecs = capabilities.codecs.slice().sort((a, b) => rank(a) - rank(b));

  try {
    transceiver.setCodecPreferences(codecs);
  } catch (e) {
    console.warn('Could not set codec preferences:', e);
  }
}

// Habilita Opus estéreo em alta qualidade (por padrão o WebRTC envia mono)
function enableStereoOpus(sdp) {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!match) return sdp;
  const pt = match[1];
  const extra = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: String(AUDIO_MAX_BITRATE) };

  const fmtpRegex = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (fmtpRegex.test(sdp)) {
    return sdp.replace(fmtpRegex, (line, params) => {
      const existing = params.split(';').map(p => p.trim()).filter(Boolean);
      const keys = existing.map(p => p.split('=')[0].toLowerCase());
      Object.entries(extra).forEach(([key, value]) => {
        if (!keys.includes(key)) existing.push(`${key}=${value}`);
      });
      return `a=fmtp:${pt} ${existing.join(';')}`;
    });
  }

  const rtpmapLine = match[0];
  const params = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(';');
  return sdp.replace(rtpmapLine, `${rtpmapLine}\r\na=fmtp:${pt} ${params}`);
}
