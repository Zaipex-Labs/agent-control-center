import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/dashboard',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../dist/dashboard',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit'],
          dicebear: ['@dicebear/core', '@dicebear/collection'],
        },
      },
    },
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
