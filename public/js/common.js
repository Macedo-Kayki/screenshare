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

// ===== ICONS (traços no estilo Lucide, 24x24) =====
const ICONS = {
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  cast: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><path d="M2 12a9 9 0 0 1 8 8"/><path d="M2 16a5 5 0 0 1 4 4"/><path d="M2 20h.01"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-x': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  pip: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  'user-minus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  switch: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  'wifi-off': '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.52"/><path d="m2 2 20 20"/>'
};

function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

function setIcon(el, name) {
  if (!el) return;
  el.dataset.icon = name;
  el.replaceChildren(createIcon(name));
}

// Preenche todo <span class="icon" data-icon="..."> da página
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (!el.firstElementChild) setIcon(el, el.dataset.icon);
  });
}

// ===== THEME =====
function getTheme() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced) return forced;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initThemeToggles() {
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    const render = () => {
      const isDark = getTheme() === 'dark';
      const label = isDark ? 'Usar tema claro' : 'Usar tema escuro';
      setIcon(btn.querySelector('.icon'), isDark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', label);
      btn.title = label;
    };
    render();
    btn.addEventListener('click', () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      storageSet('localStorage', 'ss-theme', next);
      render();
    });
  });
}

// ===== TOASTS =====
const TOAST_ICONS = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'x-circle',
  join: 'user-plus',
  leave: 'user-minus'
};

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${TOAST_ICONS[type] ? type : 'info'}`;
  const iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.appendChild(createIcon(TOAST_ICONS[type] || 'info'));
  const textEl = document.createElement('span');
  textEl.textContent = message;
  toast.append(iconEl, textEl);
  container.appendChild(toast);

  // Avisos e erros ficam mais tempo na tela
  const duration = type === 'warning' || type === 'error' ? 5000 : 3000;
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  }, duration);
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

// Cor estável do avatar a partir do nome
function nameHue(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

function createUserElement(user) {
  const isHost = user.role === 'broadcaster';
  const li = document.createElement('li');
  li.className = isHost ? 'user-item is-host' : 'user-item';
  li.dataset.userId = user.id;

  const avatar = document.createElement('div');
  avatar.className = 'user-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.style.setProperty('--hue', nameHue(user.name));
  avatar.textContent = getInitials(user.name);

  const info = document.createElement('div');
  info.className = 'user-info';

  const name = document.createElement('div');
  name.className = 'user-name';
  name.textContent = user.name;

  const role = document.createElement('div');
  role.className = 'user-role';
  role.textContent = isHost ? 'Transmitindo' : 'Assistindo';

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
  const done = () => showToast(message, 'success');
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
    showToast('Não foi possível copiar', 'error');
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

// common.js é carregado no fim do <body>: o DOM já está pronto
hydrateIcons();
initThemeToggles();
