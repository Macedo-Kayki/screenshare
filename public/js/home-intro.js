// ===== HOME INTRO (GSAP) =====
// Ordem de entrada: título (palavra por palavra) → subtítulo → card de login
// → as 3 etapas, uma de cada vez. Carregado no <head> para esconder o texto antes da primeira pintura.

(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.documentElement;
  let done = false;

  function reveal() {
    done = true;
    root.classList.remove('home-intro');
  }

  root.classList.add('home-intro');

  // Rede de segurança: o texto nunca fica escondido se o GSAP não carregar
  const fallback = setTimeout(reveal, 2500);

  document.addEventListener('DOMContentLoaded', () => {
    clearTimeout(fallback);
    if (done) return;

    const words = document.querySelectorAll('.home-title .word');
    const lead = document.querySelector('.home-lead');
    const card = document.querySelector('.home-card');
    const steps = document.querySelectorAll('.steps .step');
    if (!window.gsap || !words.length || !lead || !card || !steps.length) {
      reveal();
      return;
    }

    // gsap.from aplica o estado inicial na hora, antes de o texto voltar a ficar visível
    gsap.timeline({ delay: 0.2 })
      .from(words, {
        autoAlpha: 0,
        yPercent: 45,
        duration: 0.5,
        ease: 'power3.out',
        stagger: 0.08
      })
      .from(lead, {
        autoAlpha: 0,
        y: 16,
        duration: 0.6,
        ease: 'power2.out'
      }, '-=0.2')
      // fromTo: o destino precisa ser explícito porque a classe ainda zera a opacidade
      .fromTo(card, { opacity: 0, y: 24 }, {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: 'power3.out',
        clearProps: 'opacity,transform'
      }, '-=0.25')
      .from(steps, {
        autoAlpha: 0,
        y: 14,
        duration: 0.45,
        ease: 'power2.out',
        stagger: 0.18
      }, '+=0.05');

    reveal();
  });
})();
