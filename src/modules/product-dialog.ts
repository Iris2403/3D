import { $, $$ } from './env';
import { openDialog } from './dialogs';

/**
 * Product cards → shared product dialog.
 * Values are written with textContent / property setters only (never innerHTML), so merchant- or
 * URL-provided strings cannot inject markup.
 */
export function initProductDialog(): void {
  const dialog = $<HTMLDialogElement>('#product-dialog');
  if (!dialog) return;
  const img = $<HTMLImageElement>('[data-pd-img]', dialog);
  const avif = $<HTMLSourceElement>('[data-pd-avif]', dialog);
  if (!img || !avif) return;

  const set = (sel: string, value: string) => {
    const el = $(sel, dialog);
    if (!el) return;
    el.textContent = value;
    el.hidden = !value;
  };

  document.addEventListener('click', (e) => {
    const card = (e.target as Element).closest<HTMLElement>('[data-product]');
    if (!card) return;
    const d = card.dataset;
    set('[data-pd-name]', d.name || '');
    set('[data-pd-cat]', d.category || '');
    set('[data-pd-price]', d.price || '');
    set('[data-pd-desc]', d.desc || '');
    if (d.avif) avif.srcset = d.avif;
    else avif.removeAttribute('srcset');
    img.src = d.img || '';
    img.alt = d.alt || d.name || '';
    openDialog(dialog, card);
  });

  // Warm the large image on hover/focus intent so the dialog opens sharp.
  const warm = (e: Event) => {
    const card = (e.target as Element).closest<HTMLElement>('[data-product]');
    if (!card?.dataset.img || card.dataset.warmed) return;
    card.dataset.warmed = '1';
    const pre = new Image();
    pre.decoding = 'async';
    // AVIF is decoded by every current browser; Shopify-hosted images negotiate format themselves.
    pre.src = card.dataset.avif || card.dataset.img;
  };
  $$('[data-product]').forEach((c) => {
    c.addEventListener('pointerenter', warm, { passive: true });
    c.addEventListener('focus', warm);
  });
}
