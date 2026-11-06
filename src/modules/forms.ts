import { $, $$, t } from './env';

/**
 * Accessible client-side validation for Shopify's native forms.
 * This is a UX layer only — Shopify validates every submission server-side, applies spam/bot
 * protection and rate limits. Errors are linked to inputs via aria-describedby + aria-invalid,
 * the first invalid field receives focus, and messages are plain text (no HTML).
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

function messageFor(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const value = field.value.trim();
  if (field instanceof HTMLInputElement && field.type === 'checkbox') return field.required && !field.checked ? t('consent') : '';
  if (field.required && !value) return field instanceof HTMLSelectElement ? t('select') : t('required');
  if (!value) return '';
  if (field instanceof HTMLInputElement && field.type === 'email' && !EMAIL.test(value)) return t('email');
  if (field instanceof HTMLInputElement && field.type === 'tel' && field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) return t('phone');
  const min = Number(field.getAttribute('minlength') || 0);
  if (min && value.length < min) return t('too_short', { min });
  return '';
}

function errorEl(field: Element): HTMLElement | null {
  const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/);
  for (const id of ids) {
    const el = id ? document.getElementById(id) : null;
    if (el?.hasAttribute('data-error')) return el;
  }
  return null;
}

function setError(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, msg: string): void {
  const el = errorEl(field);
  field.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (el) {
    el.textContent = msg;
    el.hidden = !msg;
  }
}

export function initForms(): void {
  $$<HTMLFormElement>('form[data-validate]').forEach((form) => {
    const fields = $$<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type=hidden]):not([data-honeypot]), textarea, select', form);

    fields.forEach((f) => {
      // Validate on blur; re-validate live once a field has been flagged.
      f.addEventListener('blur', () => f.value && setError(f, messageFor(f)));
      f.addEventListener('input', () => f.getAttribute('aria-invalid') === 'true' && setError(f, messageFor(f)));
      f.addEventListener('change', () => f.getAttribute('aria-invalid') === 'true' && setError(f, messageFor(f)));
    });

    form.addEventListener('submit', (e) => {
      // Honeypot: real people never see or fill this field.
      const hp = $<HTMLInputElement>('[data-honeypot]', form);
      if (hp && hp.value) {
        e.preventDefault();
        return;
      }
      let first: HTMLElement | null = null;
      fields.forEach((f) => {
        if (!(f instanceof HTMLSelectElement) && f.type !== 'checkbox') f.value = f.value.trim();
        const msg = messageFor(f);
        setError(f, msg);
        if (msg && !first) first = f;
      });
      if (first) {
        e.preventDefault();
        (first as HTMLElement).focus();
        return;
      }
      // Prevent double submits.
      const btn = form.querySelector<HTMLButtonElement>('[type=submit]');
      if (btn) {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
      }
    });
  });

  // After Shopify redirects back with a result, bring it into view and announce it.
  const result = $('[data-form-status]');
  if (result && /(contact|customer)_posted|form_type/.test(location.search + location.hash)) {
    result.scrollIntoView({ block: 'center' });
    result.focus({ preventScroll: true });
  }

  // Careers: "Apply here" on a store pre-selects it in the form.
  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest<HTMLElement>('[data-apply-store]');
    const select = $<HTMLSelectElement>('[data-store-select-field]');
    if (link && select) select.value = link.dataset.applyStore || '';
  });
}
