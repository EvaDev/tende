import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Fixed port so the admin console is always at :5174 (consumer owns :5173).
    // strictPort → fail loudly if it's occupied instead of silently drifting.
    port: process.env.PORT ? parseInt(process.env.PORT) : 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/idos': 'http://localhost:3001',
    },
  },
});
