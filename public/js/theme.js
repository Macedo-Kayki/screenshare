// Aplica o tema salvo antes da primeira renderização (evita "piscar" o tema errado)
(function () {
  try {
    var theme = localStorage.getItem('ss-theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    // storage indisponível: segue o tema do sistema
  }
})();
