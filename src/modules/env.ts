// Shared environment helpers.
const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
const fine = window.matchMedia('(hover: hover) and (pointer: fine)');

export const reducedMotion = (): boolean => rm.matches;
export const finePointer = (): boolean => fine.matches;
export const onReducedMotionChange = (fn: () => void): void => rm.addEventListener('change', fn);

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

let strings: Record<string, string> = {};
try {
  strings = JSON.parse(document.getElementById('kuki-i18n')?.textContent || '{}');
} catch {
  strings = {};
}
/** Translated UI string with %var% interpolation. */
export const t = (key: string, vars: Record<string, string | number> = {}): string =>
  (strings[key] || key).replace(/%(\w+)%/g, (_, k: string) => String(vars[k] ?? ''));

// One passive scroll/resize listener for the whole page, batched to animation frames.
type Tick = () => void;
const ticks = new Set<Tick>();
let queued = false;
const run = () => {
  queued = false;
  ticks.forEach((fn) => fn());
};
const schedule = () => {
  if (!queued) {
    queued = true;
    requestAnimationFrame(run);
  }
};
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule, { passive: true });
export const onScroll = (fn: Tick): (() => void) => {
  ticks.add(fn);
  schedule();
  return () => ticks.delete(fn);
};
