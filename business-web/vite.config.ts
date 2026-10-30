import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /business/ by the API (npm run demo) or on its own (Cloudflare Pages: set VITE_API_URL).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: process.env.BUILD_OUT || '../backend/business-web', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:4000', '/auth': 'http://localhost:4000', '/uploads': 'http://localhost:4000' } },
});
