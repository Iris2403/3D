import { $, reducedMotion, finePointer } from './env';

type NavigatorExtras = Navigator & {
  connection?: { saveData?: boolean; effectiveType?: string };
  deviceMemory?: number;
};

/**
 * Decides whether the device should get the WebGL cookie, and lazy-loads it after the page is
 * interactive. The static cookie photo remains the content (and LCP) in every other case.
 */
export function initHero(): void {
  const hero = $('[data-hero]');
  const canvas = $<HTMLCanvasElement>('[data-hero-canvas]', hero || document);
  const stage = $('[data-hero-stage]', hero || document);
  if (!hero || !canvas || !stage) return;
  // Where the 3D won't run, show the open box (the closed one only makes sense before it opens).
  const staticHero = () => hero.classList.add('hero--static');
  if (hero.dataset.quality === 'off') return staticHero();

  const nav = navigator as NavigatorExtras;
  const saveData = !!nav.connection?.saveData || /(^|-)2g$/.test(nav.connection?.effectiveType || '');
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory < 2;
  if (saveData || lowMemory || reducedMotion() || !hasWebGL()) return staticHero();

  const quality: 'high' | 'low' =
    finePointer() && window.innerWidth >= 900 && (navigator.hardwareConcurrency || 4) > 4 ? 'high' : 'low';

  const start = () => {
    import('./hero3d')
      .then(({ mountHero }) => mountHero({ hero, canvas, stage, quality, model: canvas.dataset.model, art: ['art-1', 'art-2', 'art-3', 'art-4'].map((k) => canvas.dataset[k]).filter((u): u is string => !!u) }))
      .catch(() => {
        hero.classList.remove('is-3d');
        staticHero();
      });
  };
  // Load on the visitor's first sign of engagement (after the page has loaded), never during
  // LCP. Until then the real cookie photo floats with a CSS animation, so nothing looks missing.
  const events = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown'] as const;
  let armed = false;
  const trigger = () => {
    if (armed) return;
    armed = true;
    events.forEach((e) => window.removeEventListener(e, trigger));
    // Let the triggering event finish painting first (keeps INP low).
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(start, { timeout: 800 }) : setTimeout(start, 50);
  };
  const listen = () => events.forEach((e) => window.addEventListener(e, trigger, { passive: true }));
  if (document.readyState === 'complete') listen();
  else window.addEventListener('load', listen, { once: true });
}

/**
 * Cheap feature test only. Creating a throwaway WebGL context here would initialise the GPU
 * process on the load path; instead the real renderer is created lazily and, if that fails,
 * mountHero throws and the photo simply stays.
 */
function hasWebGL(): boolean {
  return typeof WebGLRenderingContext !== 'undefined';
}
