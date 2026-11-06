import { $, $$, finePointer, reducedMotion } from './env';

/**
 * Desktop-only niceties: magnetic CTAs and a decorative cursor follower.
 * The native cursor is never hidden, and nothing here is required to use the site.
 */
export function initPointerFx(): void {
  if (!finePointer() || reducedMotion()) return;

  // Magnetic buttons
  $$('[data-magnetic]').forEach((el) => {
    // Gentle pull, capped, so neighbouring buttons can never touch.
    const strength = 0.16;
    const max = 6;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = Math.max(-max, Math.min(max, (e.clientX - (r.left + r.width / 2)) * strength));
      const y = Math.max(-max, Math.min(max, (e.clientY - (r.top + r.height / 2)) * strength));
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transition = 'transform .6s cubic-bezier(.34,1.56,.64,1)';
      el.style.transform = '';
      window.setTimeout(() => (el.style.transition = ''), 600);
    });
  });

  // Tilt on product cards
  $$('.product-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--tilt-y', `${(px * 6).toFixed(2)}deg`);
      card.style.setProperty('--tilt-x', `${(-py * 6).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    });
  });

  // Cursor follower
  const cursor = $('.cursor');
  const label = $('.cursor__label');
  if (!cursor || !label) return;
  let x = 0, y = 0, cx = 0, cy = 0, raf = 0;
  const loop = () => {
    cx += (x - cx) * 0.2;
    cy += (y - cy) * 0.2;
    cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    raf = Math.abs(x - cx) + Math.abs(y - cy) > 0.3 ? requestAnimationFrame(loop) : 0;
  };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX;
    y = e.clientY;
    cursor.classList.add('is-visible');
    if (!raf) raf = requestAnimationFrame(loop);
    const target = (e.target as Element).closest<HTMLElement>('[data-cursor]');
    cursor.classList.toggle('is-label', !!target);
    label.textContent = target?.dataset.cursor || '';
  }, { passive: true });
  document.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
}
