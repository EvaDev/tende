import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Fixed at :5173 — must match WEBAUTHN_ORIGIN. strictPort → fail loudly if
    // occupied instead of drifting to another port (which would break WebAuthn).
    port: parseInt(process.env.PORT ?? '5173'),
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
