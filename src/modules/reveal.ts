import { $$, clamp, onScroll, reducedMotion } from './env';

/** Scroll-triggered reveals (CSS does the animation; this only flips .is-in once). */
export function initReveal(): void {
  const els = $$('[data-reveal], [data-split], [data-clip]');
  if (!('IntersectionObserver' in window) || reducedMotion()) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          // Word reveals clip each word while it rises in; unclip once every word has landed.
          if (entry.target.hasAttribute('data-split')) {
            const words = entry.target.querySelectorAll('.w').length;
            window.setTimeout(() => entry.target.classList.add('is-done'), 1000 + words * 55 + 150);
          }
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  els.forEach((el) => io.observe(el));
}

/** Subtle image parallax ([data-parallax="0.1"]); only computed for elements on screen. */
export function initParallax(): void {
  if (reducedMotion()) return;
  const items = $$('[data-parallax]');
  if (!items.length) return;
  const visible = new Set<HTMLElement>();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target as HTMLElement) : visible.delete(e.target as HTMLElement)));
  });
  items.forEach((el) => io.observe(el));
  onScroll(() => {
    const vh = window.innerHeight;
    visible.forEach((el) => {
      const r = el.getBoundingClientRect();
      const speed = parseFloat(el.dataset.parallax || '0.1');
      const progress = clamp((r.top + r.height / 2 - vh / 2) / vh, -1, 1);
      el.style.setProperty('--py', `${(-progress * speed * 100).toFixed(2)}px`);
    });
  });
}
