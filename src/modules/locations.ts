import { $, $$, t } from './env';

/**
 * Store finder: a live Google Map that follows the selected store, and a nearest-store sort using
 * the browser's geolocation — the position never leaves the device.
 */
export function initLocations(): void {
  const root = $('[data-locations]');
  if (!root) return;
  const list = $('[data-store-list]', root);
  const stores = $$('[data-store]', root);
  const frame = $<HTMLIFrameElement>('[data-map-frame]', root);
  const label = $('[data-map-label]', root);
  const locateBtn = $<HTMLButtonElement>('[data-locate]', root);
  const status = $('[data-locate-status]', root);
  if (!list || !stores.length) return;

  const embedUrl = (query: string) => `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;

  // Selecting a store highlights it and moves the live Google Map to it.
  const select = (index: number) => {
    stores.forEach((s) => {
      const on = Number(s.dataset.index) === index;
      s.classList.toggle('is-active', on);
      s.querySelector('[data-store-select]')?.setAttribute('aria-pressed', String(on));
    });
    const store = stores.find((s) => Number(s.dataset.index) === index);
    if (!store || !frame) return;
    const name = store.dataset.name || '';
    const src = embedUrl(store.dataset.query || '');
    if (frame.src !== src) frame.src = src;
    frame.title = t('map_frame', { name });
    if (label) label.textContent = `Kuki ${name}`;
  };

  list.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('[data-store-select]');
    const store = btn?.closest<HTMLElement>('[data-store]');
    if (store) select(Number(store.dataset.index));
  });

  // ---- Nearest store
  const toRad = (d: number) => (d * Math.PI) / 180;
  const km = (a: [number, number], b: [number, number]) => {
    const R = 6371;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  if (!('geolocation' in navigator)) {
    if (locateBtn) locateBtn.hidden = true;
    return;
  }
  locateBtn?.addEventListener('click', () => {
    if (status) status.textContent = t('locating');
    locateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        const me: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        const withDist = stores
          .map((s) => ({ el: s, d: km(me, [parseFloat(s.dataset.lat || '0'), parseFloat(s.dataset.lng || '0')]) }))
          .sort((a, b) => a.d - b.d);
        withDist.forEach(({ el, d }) => {
          const label = el.querySelector('[data-store-dist]');
          if (label) label.textContent = t('km_away', { km: d < 10 ? d.toFixed(1) : Math.round(d) });
          list.appendChild(el); // re-order the list by distance
        });
        const nearest = withDist[0];
        select(Number(nearest.el.dataset.index));
        if (status) status.textContent = t('nearest', { name: nearest.el.dataset.name || '', km: nearest.d < 10 ? nearest.d.toFixed(1) : Math.round(nearest.d) });
        nearest.el.querySelector<HTMLElement>('[data-store-select]')?.focus();
      },
      (err) => {
        locateBtn.disabled = false;
        if (status) status.textContent = err.code === err.PERMISSION_DENIED ? t('geo_denied') : t('geo_unavailable');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}
