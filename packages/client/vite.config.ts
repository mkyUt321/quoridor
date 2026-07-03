import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/quick': { target: 'http://localhost:8787' },
    },
  },
});
