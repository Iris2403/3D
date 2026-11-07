import { defineConfig } from 'vite';

// Builds the theme's JS straight into theme/assets (Shopify needs a flat assets folder).
// - kuki.js: small core bundle, loaded as a module in layout/theme.liquid
// - kuki-hero3d-[hash].js + three: lazy chunk, fetched only when the 3D hero can run
export default defineConfig({
  base: './',
  build: {
    outDir: 'theme/assets',
    emptyOutDir: false, // never wipe images/fonts in theme/assets
    target: 'es2020',
    modulePreload: false,
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'kuki.js',
        chunkFileNames: 'kuki-[name]-[hash].js',
      },
      preserveEntrySignatures: false,
    },
  },
});
