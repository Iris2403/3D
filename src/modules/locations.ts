import { $, $$, t } from './env';

/**
 * Store finder: select a store (list or map pin), load Google Maps only on request,
 * and sort by distance using the browser's geolocation — the position never leaves the device.
 */
export function initLocations(): void {
  const root = $('[data-locations]');
  if (!root) return;
  const list = $('[data-store-list]', root);
  const stores = $$('[data-store]', root);
  const pins = $$<SVGGElement>('[data-pin]', root);
  const embed = $('[data-map-embed]', root);
  const loadBtn = $<HTMLButtonElement>('[data-map-load]', root);
  const locateBtn = $<HTMLButtonElement>('[data-locate]', root);
  const status = $('[data-locate-status]', root);
  if (!list || !stores.length) return;

  let active = 0;
  let mapLoaded = false;

  const embedUrl = (query: string) => `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;

  const select = (index: number) => {
    active = index;
    stores.forEach((s) => {
      const on = Number(s.dataset.index) === index;
      s.classList.toggle('is-active', on);
      s.querySelector('[data-store-select]')?.setAttribute('aria-pressed', String(on));
    });
    pins.forEach((p) => p.classList.toggle('is-active', Number(p.dataset.pin) === index));
    if (mapLoaded) showMap();
  };

  const showMap = () => {
    if (!embed) return;
    const store = stores.find((s) => Number(s.dataset.index) === active);
    if (!store) return;
    let frame = embed.querySelector('iframe');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      frame.setAttribute('allowfullscreen', '');
      embed.appendChild(frame);
    }
    frame.title = t('map_frame', { name: store.dataset.name || '' });
    frame.src = embedUrl(store.dataset.query || '');
    embed.hidden = false;
    mapLoaded = true;
    if (loadBtn) loadBtn.hidden = true;
  };

  list.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('[data-store-select]');
    const store = btn?.closest<HTMLElement>('[data-store]');
    if (store) select(Number(store.dataset.index));
  });
  pins.forEach((p) =>
    p.addEventListener('click', () => {
      const i = Number(p.dataset.pin);
      select(i);
      stores[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }),
  );
  loadBtn?.addEventListener('click', showMap);

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
