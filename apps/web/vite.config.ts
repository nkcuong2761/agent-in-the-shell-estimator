import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the site from /<repo>/; override with VITE_BASE. The dev server always uses "/".
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : (process.env.VITE_BASE ?? '/agent-in-the-shell-estimator/'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@data': fileURLToPath(new URL('../../data', import.meta.url)),
    },
  },
  server: { port: 5173, fs: { allow: ['../..'] } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
}));
