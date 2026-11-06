import { $$ } from './env';

/** Shared <dialog> behaviour: close buttons, backdrop click, body scroll lock. */
export function initDialogs(): void {
  $$<HTMLDialogElement>('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-dialog-close]')) {
        dialog.close();
        return;
      }
      // Click on the backdrop (the dialog element itself, outside its content box).
      if (target === dialog && !dialog.classList.contains('mobile-menu')) {
        const r = dialog.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dialog.close();
      }
    });
    const observer = new MutationObserver(() => {
      const anyOpen = $$<HTMLDialogElement>('dialog').some((d) => d.open);
      document.documentElement.style.overflow = anyOpen ? 'hidden' : '';
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });
}

/** Open a modal dialog and return focus to the opener when it closes. */
export function openDialog(dialog: HTMLDialogElement, opener?: HTMLElement | null): void {
  dialog.showModal();
  dialog.addEventListener(
    'close',
    () => {
      opener?.focus({ preventScroll: true });
    },
    { once: true },
  );
}
