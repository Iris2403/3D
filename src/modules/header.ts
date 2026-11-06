import { $, onScroll } from './env';

/** Adaptive header: transparent over the hero, solid after it, hides on scroll-down, returns on scroll-up. */
export function initHeader(): void {
  const header = $('[data-header]');
  if (!header) return;
  let last = window.scrollY;
  const root = document.documentElement;

  onScroll(() => {
    const y = window.scrollY;
    const solid = y > 40;
    header.classList.toggle('is-solid', solid);
    const goingDown = y > last + 4;
    const goingUp = y < last - 4;
    // Never hide while keyboard focus is inside the header.
    const focused = header.contains(document.activeElement);
    if (goingDown && y > 320 && !focused) {
      header.classList.add('is-hidden');
      root.classList.add('header-hidden');
    } else if (goingUp || y < 320) {
      header.classList.remove('is-hidden');
      root.classList.remove('header-hidden');
    }
    last = y;
  });
  header.addEventListener('focusin', () => {
    header.classList.remove('is-hidden');
    root.classList.remove('header-hidden');
  });

  // Mobile menu (<dialog>): native focus trap and Esc.
  const dialog = $<HTMLDialogElement>('#mobile-menu');
  const toggle = $<HTMLButtonElement>('[data-menu-open]');
  if (dialog && toggle) {
    toggle.addEventListener('click', () => {
      dialog.showModal();
      toggle.setAttribute('aria-expanded', 'true');
    });
    dialog.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
    // Same-page anchors (e.g. /#about) must close the menu.
    dialog.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => dialog.close()));
    window.matchMedia('(min-width: 1000px)').addEventListener('change', (e) => e.matches && dialog.open && dialog.close());
  }
}
