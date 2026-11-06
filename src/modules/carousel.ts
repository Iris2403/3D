import { $, $$, reducedMotion } from './env';

/**
 * Enhances a native scroll-snap list: prev/next buttons, progress bar, mouse drag.
 * Touch, trackpad, keyboard (focus the track, use arrow keys) work natively without this.
 */
export function initCarousels(): void {
  $$('[data-carousel]').forEach((root) => {
    const track = $<HTMLElement>('[data-carousel-track]', root);
    const prev = $<HTMLButtonElement>('[data-carousel-prev]', root);
    const next = $<HTMLButtonElement>('[data-carousel-next]', root);
    const bar = $<HTMLElement>('[data-carousel-progress]', root);
    if (!track) return;

    const step = () => {
      const item = track.querySelector('li');
      const gap = parseFloat(getComputedStyle(track).columnGap || '16');
      return item ? item.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    };
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      const p = max > 0 ? track.scrollLeft / max : 1;
      if (prev) prev.disabled = track.scrollLeft < 4;
      if (next) next.disabled = track.scrollLeft > max - 4;
      bar?.style.setProperty('--p', String(Math.max(0.08, p)));
    };
    const behavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');
    prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: behavior() }));
    next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: behavior() }));
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();

    // Arrow keys while the track itself has focus.
    track.addEventListener('keydown', (e) => {
      if (e.target !== track) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        track.scrollBy({ left: step(), behavior: behavior() });
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        track.scrollBy({ left: -step(), behavior: behavior() });
      }
    });

    // Mouse drag-to-scroll (touch already scrolls natively). A drag never triggers a click.
    let down = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = track.scrollLeft;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        track.classList.add('is-dragging');
      }
      if (moved) track.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (!moved) return;
      track.classList.remove('is-dragging');
      const s = step();
      track.scrollTo({ left: Math.round(track.scrollLeft / s) * s, behavior: behavior() });
      track.addEventListener(
        'click',
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        },
        { capture: true, once: true },
      );
    });
  });
}
