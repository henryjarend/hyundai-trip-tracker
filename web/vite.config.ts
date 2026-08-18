import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, Vite serves the UI and forwards API calls to the Fastify server.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
