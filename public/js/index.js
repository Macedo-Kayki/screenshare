// ===== INDEX LOGIC =====

const socket = io();

const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('room-code');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');

const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;

// Nome lembrado da última visita
usernameInput.value = storageGet('localStorage', 'ss-name') || '';

// Link de convite: /?room=ABC123
const invitedRoom = (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
if (ROOM_CODE_REGEX.test(invitedRoom)) {
  roomCodeInput.value = invitedRoom;
  document.getElementById('invite-code').textContent = invitedRoom;
  document.getElementById('invite-banner').hidden = false;
  btnJoin.classList.replace('btn-secondary', 'btn-primary');
  btnCreate.classList.replace('btn-primary', 'btn-secondary');
}

usernameInput.focus();

// Enter key behavior
usernameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (ROOM_CODE_REGEX.test(roomCodeInput.value)) joinRoom();
  else roomCodeInput.focus();
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

// Force uppercase on room code
roomCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  e.target.removeAttribute('aria-invalid');
});

usernameInput.addEventListener('input', () => usernameInput.removeAttribute('aria-invalid'));

btnCreate.addEventListener('click', createRoom);
btnJoin.addEventListener('click', joinRoom);

function markInvalid(input, message) {
  input.setAttribute('aria-invalid', 'true');
  input.focus();
  showToast(message, '⚠️');
}

function getName() {
  const name = usernameInput.value.trim();
  if (!name) {
    markInvalid(usernameInput, 'Digite seu nome');
    return null;
  }
  storageSet('localStorage', 'ss-name', name);
  return name;
}

function setCreating(isCreating) {
  btnCreate.disabled = isCreating;
  if (isCreating) {
    btnCreate.replaceChildren();
    const spinner = document.createElement('div');
    spinner.className = 'spinner spinner-sm';
    btnCreate.append(spinner, ' Criando...');
  } else {
    btnCreate.textContent = '📡 Iniciar Transmissão';
  }
}

function createRoom() {
  const name = getName();
  if (!name) return;

  setCreating(true);

  socket.timeout(8000).emit('create-room', { name }, (err, response) => {
    if (err || !response || response.error || !response.roomId) {
      setCreating(false);
      showToast((response && response.error) || 'Não foi possível criar a sala. Tente novamente.', '❌');
      return;
    }

    // O token fica na aba (sobrevive a F5) e não vai para a query string
    const tokenKey = `ss-token-${response.roomId}`;
    storageSet('sessionStorage', tokenKey, response.token);
    let url = `/broadcast.html?room=${response.roomId}&name=${encodeURIComponent(name)}`;
    // Sem sessionStorage disponível: passa pelo hash (não é enviado ao servidor)
    if (storageGet('sessionStorage', tokenKey) !== response.token) {
      url += `#token=${response.token}`;
    }
    window.location.href = url;
  });
}

function joinRoom() {
  const name = getName();
  if (!name) return;

  const code = roomCodeInput.value.trim();
  if (!ROOM_CODE_REGEX.test(code)) {
    markInvalid(roomCodeInput, 'O código da sala tem 6 caracteres');
    return;
  }

  window.location.href = `/watch.html?room=${code}&name=${encodeURIComponent(name)}`;
}
