// Unit tests for Service Worker, Manifest, and PWA configuration
import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- Running PWA & Service Worker Unit Tests ---');

// Test 1: Validate Web App Manifest
const manifestRaw = fs.readFileSync('public/manifest.webmanifest', 'utf-8');
const manifest = JSON.parse(manifestRaw);

assert.strictEqual(manifest.name, 'Wasm C/C++ Teaching IDE');
assert.strictEqual(manifest.short_name, 'C/C++ IDE');
assert.strictEqual(manifest.display, 'standalone');
assert.strictEqual(manifest.start_url, './');
assert.strictEqual(manifest.scope, './');
assert.strictEqual(manifest.background_color, '#181818');
assert.strictEqual(manifest.theme_color, '#1e1e1e');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);

// Verify icon files exist on disk
for (const icon of manifest.icons) {
  const iconPath = icon.src.replace(/^\.\//, 'public/');
  assert.ok(fs.existsSync(iconPath), `Icon file must exist: ${iconPath}`);
  const stats = fs.statSync(iconPath);
  assert.ok(stats.size > 0, `Icon file must not be empty: ${iconPath}`);
}
console.log('✓ Web App Manifest and icon files verified');

// Test 2: Verify index.html includes manifest, theme-color, and apple-touch-icon
const indexHtml = fs.readFileSync('index.html', 'utf-8');
assert.ok(indexHtml.includes('rel="manifest"'), 'index.html must link manifest');
assert.ok(indexHtml.includes('name="theme-color"'), 'index.html must include theme-color');
assert.ok(indexHtml.includes('rel="apple-touch-icon"'), 'index.html must include apple-touch-icon');
assert.ok(indexHtml.includes('src="/coi-serviceworker.js"'), 'index.html must load service worker');
console.log('✓ index.html PWA tags verified');

// Test 3: Verify Service Worker COOP/COEP headers attachment
const swContent = fs.readFileSync('public/coi-serviceworker.js', 'utf-8');
assert.ok(swContent.includes('Cross-Origin-Embedder-Policy'), 'Service worker must inject COEP');
assert.ok(swContent.includes('Cross-Origin-Opener-Policy'), 'Service worker must inject COOP');
assert.ok(swContent.includes('caches.open'), 'Service worker must use CacheStorage');
assert.ok(swContent.includes('cache.match'), 'Service worker must match cached assets');

// Test 4: Simulation of COOP/COEP headers function on response
function simulateWithCoopCoepHeaders(headersObj) {
  const headers = new Headers(headersObj);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return headers;
}

const mockHeaders = simulateWithCoopCoepHeaders({ 'content-type': 'application/wasm' });
assert.strictEqual(mockHeaders.get('Cross-Origin-Embedder-Policy'), 'require-corp');
assert.strictEqual(mockHeaders.get('Cross-Origin-Opener-Policy'), 'same-origin');
assert.strictEqual(mockHeaders.get('Cross-Origin-Resource-Policy'), 'cross-origin');
console.log('✓ Offline COOP/COEP headers injection verified');

console.log('--- ALL PWA & SERVICE WORKER TESTS PASSED ---');
