import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Auch der Entwicklungsserver bindet nur an die lokale Adresse.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Kleine Dateien bettet Vite sonst als `data:`-Adresse ein. Schriften dürfen das nicht: die CSP erlaubt
    // `font-src 'self'` ohne `data:`, KaTeX bringt kleine Schriftdateien mit (D-048).
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  test: {
    // Komponententests wählen jsdom per Kommentar `@vitest-environment jsdom` in der Datei.
    setupFiles: ['./src/test/setup.ts'],
  },
});
