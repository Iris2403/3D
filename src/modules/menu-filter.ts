import { $, $$, t } from './env';

/** Category filter for the full menu. Without JS all groups show with their own headings. */
export function initMenuFilter(): void {
  const root = $('[data-menu]');
  if (!root) return;
  const tabs = $('[data-menu-tabs]', root);
  if (!tabs) return;
  const groups = $$('[data-group]', root);
  const status = $('[data-menu-status]', root);
  tabs.hidden = false;

  const apply = (filter: string, label: string, announce = true) => {
    let count = 0;
    groups.forEach((g) => {
      const show = filter === 'all' || g.dataset.group === filter;
      g.hidden = !show;
      if (show) count += g.querySelectorAll('[data-product]').length;
    });
    $$<HTMLButtonElement>('[data-filter]', tabs).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    if (status && announce) status.textContent = t('showing', { label, count });
    // Newly shown cards may not have been revealed yet.
    groups.forEach((g) => !g.hidden && g.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in')));
  };

  tabs.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-filter]');
    if (!btn) return;
    apply(btn.dataset.filter || 'all', btn.textContent?.trim() || '');
    const top = root.getBoundingClientRect().top + window.scrollY - 120;
    if (window.scrollY > top) window.scrollTo({ top });
  });

  // Deep links like /pages/menu#menu-coffee pre-select a category.
  const key = location.hash.startsWith('#menu-') ? location.hash.slice(6).replace(/-/g, '_') : '';
  const preset = key ? tabs.querySelector<HTMLButtonElement>(`[data-filter="${CSS.escape(key)}"]`) : null;
  if (preset) apply(key, preset.textContent?.trim() || '', false);
}
