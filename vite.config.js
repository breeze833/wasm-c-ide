import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function serveSysrootMiddleware(req, res, next) {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath.includes('/sysroot/wasm/')) {
    const relativePart = urlPath.substring(urlPath.indexOf('/sysroot/wasm/'));
    const filePath = path.join(process.cwd(), 'public', relativePart);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = ext === '.wasm' ? 'application/wasm' : 'application/octet-stream';
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }
  next();
}

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
  plugins: [
    {
      name: 'emulate-production-sysroot',
      configureServer(server) {
        server.middlewares.use(serveSysrootMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(serveSysrootMiddleware);
      },
    },
  ],
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

