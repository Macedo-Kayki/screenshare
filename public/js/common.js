// ===== COMMON UTILITIES =====

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
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

function showToast(message, icon = 'ℹ️') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function createUserElement(user) {
  const li = document.createElement('li');
  li.className = 'user-item';
  li.dataset.userId = user.id;
  li.innerHTML = `
    <div class="user-avatar">${getInitials(user.name)}</div>
    <div class="user-info">
      <div class="user-name">${user.name}</div>
      <div class="user-role">${user.role === 'broadcaster' ? '📡 Transmitindo' : '👁️ Assistindo'}</div>
    </div>
  `;
  return li;
}

function updateUserList(listElement, users, countElement) {
  listElement.innerHTML = '';
  users.forEach(user => {
    listElement.appendChild(createUserElement(user));
  });
  if (countElement) {
    const viewerCount = users.filter(u => u.role === 'viewer').length;
    countElement.textContent = `${viewerCount} espectador${viewerCount !== 1 ? 'es' : ''}`;
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Código copiado!', '📋');
  }).catch(() => {
    // Fallback
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('Código copiado!', '📋');
  });
}
