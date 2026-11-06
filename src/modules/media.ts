import { $$, reducedMotion } from './env';

/**
 * Decorative brand videos: fetched only near the viewport, play while visible, pause off-screen.
 * With reduced motion they stay on their poster frame.
 */
export function initVideos(): void {
  const videos = $$<HTMLVideoElement>('video[data-autoplay]');
  if (!videos.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const v = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && !reducedMotion()) {
          if (v.preload === 'none') v.preload = 'auto';
          v.play().catch(() => {
            /* autoplay refused: poster stays */
          });
        } else {
          v.pause();
        }
      });
    },
    { rootMargin: '120px 0px', threshold: 0.1 },
  );
  videos.forEach((v) => io.observe(v));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) videos.forEach((v) => v.pause());
  });
}
