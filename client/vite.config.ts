/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/media': { target: 'http://localhost:8080' },
      // Без этого звуки не открываются в дев-режиме: клиент на порту Vite,
      // файлы отдаёт сервер на 8080 — ровно та же причина, что у /media.
      '/audio': { target: 'http://localhost:8080' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
  },
});
