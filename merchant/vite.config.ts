import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Fixed port — server:3001, consumer:5173, admin:5174, merchant:5175.
    port: process.env.PORT ? parseInt(process.env.PORT) : 5175,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
