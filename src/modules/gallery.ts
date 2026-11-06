import { $, $$, t } from './env';
import { openDialog } from './dialogs';

/** Full-screen gallery viewer: buttons, arrow keys, swipe; native <dialog> handles focus + Esc. */
export function initGallery(): void {
  const dialog = $<HTMLDialogElement>('#lightbox');
  if (!dialog) return;
  const img = $<HTMLImageElement>('[data-lb-img]', dialog);
  const avif = $<HTMLSourceElement>('[data-lb-avif]', dialog);
  const count = $('[data-lb-count]', dialog);
  const prev = $<HTMLButtonElement>('[data-lb-prev]', dialog);
  const next = $<HTMLButtonElement>('[data-lb-next]', dialog);
  if (!img || !avif) return;

  let items: HTMLElement[] = [];
  let index = 0;

  const show = (i: number) => {
    index = (i + items.length) % items.length;
    const d = items[index].dataset;
    if (d.avif) avif.srcset = d.avif;
    else avif.removeAttribute('srcset');
    img.src = d.img || '';
    img.alt = d.alt || '';
    if (count) count.textContent = t('image_of', { i: index + 1, n: items.length });
    // Prefetch the neighbour for instant next.
    const n = items[(index + 1) % items.length]?.dataset;
    if (n) new Image().src = n.avif || n.img || '';
  };

  document.addEventListener('click', (e) => {
    const tile = (e.target as Element).closest<HTMLElement>('[data-gallery-item]');
    if (!tile) return;
    const gallery = tile.closest('[data-gallery]');
    items = gallery ? $$('[data-gallery-item]', gallery) : [tile];
    show(items.indexOf(tile));
    openDialog(dialog, tile);
  });
  prev?.addEventListener('click', () => show(index - 1));
  next?.addEventListener('click', () => show(index + 1));
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  let x0: number | null = null;
  dialog.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  dialog.addEventListener(
    'touchend',
    (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
      x0 = null;
    },
    { passive: true },
  );
}
