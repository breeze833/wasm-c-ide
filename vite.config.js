import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_URL || './',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    port: 5173,
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    port: 4173,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['@xterm/xterm', '@xterm/addon-fit'],
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit'],
          jszip: ['jszip'],
        },
      },
    },
  },
});
