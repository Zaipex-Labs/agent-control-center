import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/dashboard',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../dist/dashboard',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7899',
      '/ws/terminal': {
        target: 'ws://localhost:7899',
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:7899',
        ws: true,
      },
      '/health': 'http://localhost:7899',
    },
  },
});
