import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    proxy: {
      '/api': 'http://localhost:3001',
      '/idos': 'http://localhost:3001',
    },
  },
});
