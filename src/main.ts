/**
 * KUKI theme — client entry.
 * Progressive enhancement: every feature below upgrades HTML that already works without JS.
 * Heavy code (three.js hero) is split into a lazy chunk loaded by ./modules/hero.
 */
import { initHeader } from './modules/header';
import { initDialogs } from './modules/dialogs';
import { initReveal, initParallax } from './modules/reveal';
import { initPointerFx } from './modules/pointer-fx';
import { initCarousels } from './modules/carousel';
import { initProductDialog } from './modules/product-dialog';
import { initMenuFilter } from './modules/menu-filter';
import { initProcess } from './modules/process';
import { initLocations } from './modules/locations';
import { initGallery } from './modules/gallery';
import { initForms } from './modules/forms';
import { initVideos } from './modules/media';
import { initHero } from './modules/hero';

const safe = (name: string, fn: () => void) => {
  try {
    fn();
  } catch (err) {
    // One broken enhancement must never take the rest of the page down.
    if (import.meta.env.DEV) console.error(`[kuki] ${name} failed`, err);
  }
};

safe('header', initHeader);
safe('dialogs', initDialogs);
safe('reveal', initReveal);
safe('forms', initForms);
safe('carousel', initCarousels);
safe('product', initProductDialog);
safe('menu', initMenuFilter);
safe('process', initProcess);
safe('locations', initLocations);
safe('gallery', initGallery);
safe('videos', initVideos);
safe('hero', initHero);
// Purely decorative, after first paint.
requestAnimationFrame(() => {
  safe('parallax', initParallax);
  safe('pointer', initPointerFx);
});
