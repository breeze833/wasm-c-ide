// IndexedDB Persistent Cache for compiled WebAssembly.Module instances & ArrayBuffers
// Delegates cache implementation to web-ide-core/wasi/cache with wasm-c-ide DB configuration

import { createWasmCache } from 'web-ide-core/wasi/cache';

export const {
  openWasmDb,
  getWasmModule,
  saveWasmModule,
  deleteWasmModule,
  clearWasmCache,
} = createWasmCache({
  dbName: 'wasm-c-ide-wasm-cache',
  storeName: 'wasm_modules',
});
