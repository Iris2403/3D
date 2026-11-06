import { $, clamp, onScroll, reducedMotion } from './env';

/**
 * Desktop: a sticky horizontal track whose X position follows *native* vertical scroll.
 * Nothing intercepts wheel/touch/keys, so scrolling, keyboard and assistive tech behave normally.
 * Mobile, short viewports and reduced motion: a plain grid / vertical stack.
 */
export function initProcess(): void {
  const section = $('[data-process]');
  if (!section) return;
  const pin = $('[data-process-pin]', section);
  const track = $('[data-process-track]', section);
  const bar = $('[data-process-progress]', section);
  if (!pin || !track) return;
  const mq = window.matchMedia('(min-width: 1024px)');

  let enabled = false;
  let distance = 0;
  const measure = () => {
    enabled = mq.matches && !reducedMotion() && window.innerHeight >= 600;
    section.classList.toggle('is-horizontal', enabled);
    if (!enabled) {
      track.style.removeProperty('--x');
      pin.style.removeProperty('--pin-h');
      return;
    }
    distance = Math.max(0, track.scrollWidth - window.innerWidth);
    pin.style.setProperty('--pin-h', `${window.innerHeight + distance}px`);
  };
  measure();
  window.addEventListener('resize', measure, { passive: true });
  mq.addEventListener('change', measure);

  onScroll(() => {
    if (!enabled) return;
    const r = pin.getBoundingClientRect();
    const p = clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
    track.style.setProperty('--x', `${(-p * distance).toFixed(1)}px`);
    bar?.style.setProperty('--p', p.toFixed(3));
  });
}
