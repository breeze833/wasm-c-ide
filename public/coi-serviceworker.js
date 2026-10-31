/*! coi-serviceworker v0.1.7 - Guido Zuidhof, MIT / Unified with Offline PWA CacheStorage */
let coepCredentialless = false;
const CACHE_NAME = 'wasm-c-ide-cache-v1';

if (typeof window === 'undefined') {
  self.addEventListener('install', (event) => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      ).then(() => self.clients.claim())
    );
  });

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration.unregister().then(() => {
        return self.clients.matchAll();
      }).then(clients => {
        clients.forEach(client => client.navigate(client.url));
      });
    }
  });

  function withCoopCoepHeaders(response) {
    if (!response || response.status === 0) return response;
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
    if (!coepCredentialless) {
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  self.addEventListener('fetch', function (event) {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) return;

    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
      return;
    }

    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const isNav = request.mode === 'navigate';

        // 1. For non-navigation requests, check cache first (Cache-First)
        if (!isNav) {
          const cached = await cache.match(request);
          if (cached) {
            return withCoopCoepHeaders(cached);
          }
        }

        // 2. Fetch from network
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
            // For large WebAssembly modules (e.g. llvm-box.wasm ~56MB), bypass CacheStorage cloning
            // to avoid Service Worker stream buffer exhaustion and timeout aborts.
            // The compiled WebAssembly.Module is persisted directly in IndexedDB.
            const isLargeBinary = url.pathname.endsWith('/llvm-box.wasm');
            if (!isLargeBinary) {
              cache.put(request, networkResponse.clone()).catch(() => {});
            }
          }
          return withCoopCoepHeaders(networkResponse);
        } catch (err) {
          // 3. Network failed (offline fallback)
          const cached = await cache.match(request);
          if (cached) {
            return withCoopCoepHeaders(cached);
          }

          // For navigation requests falling back offline, match index.html
          if (isNav) {
            const fallback =
              (await cache.match(url.pathname)) ||
              (await cache.match(url.origin + url.pathname + 'index.html')) ||
              (await cache.match('./index.html')) ||
              (await cache.match('/index.html'));
            if (fallback) {
              return withCoopCoepHeaders(fallback);
            }
          }

          throw err;
        }
      })()
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf');
    window.sessionStorage.removeItem('coiReloadedBySelf');

    if ('serviceWorker' in navigator) {
      const n = navigator.serviceWorker;
      const scriptUrl = window.document.currentScript ? window.document.currentScript.src : '/coi-serviceworker.js';

      n.register(scriptUrl).then(
        (registration) => {
          registration.addEventListener('updatefound', () => {
            if (!window.crossOriginIsolated) {
              window.location.reload();
            }
          });

          if (!window.crossOriginIsolated && registration.active && !n.controller) {
            window.location.reload();
          }
        },
        (err) => {
          console.error('Service worker registration failed: ', err);
        }
      );
    }
  })();
}
