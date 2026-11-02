// Unit tests for Project Settings Upgrade / Update System Button & Confirmation Flow
import assert from 'node:assert';
import fs from 'node:fs';
import { SettingsModal, upgradeSystemFiles } from '../src/components/settings.js';
import { VFS } from '../src/vfs/vfs.js';

console.log('--- Running Project Settings Upgrade System Unit Tests ---');

// 1. Verify HTML and CSS source files
{
  const settingsSrc = fs.readFileSync('src/components/settings.js', 'utf8');
  assert.ok(settingsSrc.includes('modal-upgrade-btn'), 'settings.js must render modal-upgrade-btn');
  assert.ok(settingsSrc.includes('modal-header-actions'), 'settings.js must wrap header actions');
  assert.ok(settingsSrc.includes('btn-upgrade-system'), 'settings.js must apply btn-upgrade-system class');
  assert.ok(settingsSrc.includes('upgrade-confirm-overlay'), 'settings.js must create upgrade-confirm-overlay');
  assert.ok(settingsSrc.includes('confirm-proceed-btn'), 'settings.js must provide confirm-proceed-btn');
  assert.ok(settingsSrc.includes('upgradeSystemFiles'), 'settings.js must export upgradeSystemFiles');

  const cssSrc = fs.readFileSync('src/style.css', 'utf8');
  assert.ok(cssSrc.includes('.modal-header-actions'), 'style.css must style .modal-header-actions');
  assert.ok(cssSrc.includes('.btn-upgrade-system'), 'style.css must style .btn-upgrade-system');
  assert.ok(cssSrc.includes('.confirm-overlay'), 'style.css must style .confirm-overlay');
  assert.ok(cssSrc.includes('.confirm-card'), 'style.css must style .confirm-card');
  assert.ok(cssSrc.includes('.confirm-notice'), 'style.css must style .confirm-notice');
  console.log('✓ Source structure and CSS rules verified for Update System button');
}

// 2. Interactive DOM Test: Render SettingsModal and verify Confirmation Flow
{
  // Minimal DOM node mock
  class MockElement {
    constructor(tagName, id = '', className = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = className;
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this._innerHTML = '';
      this.listeners = {};
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(html) {
      this._innerHTML = html;
      this.children = [];
      // Simple parser for elements with id and class
      const idMatches = [...html.matchAll(/id="([^"]+)"/g)];

      // Helper to add mock child
      const ids = idMatches.map(m => m[1]);
      for (const elId of ids) {
        const child = new MockElement('div', elId);
        child.parentNode = this;
        this.children.push(child);
      }
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx !== -1) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
    }

    querySelector(selector) {
      if (selector.startsWith('#')) {
        const targetId = selector.substring(1);
        if (this.id === targetId) return this;
        for (const child of this.children) {
          const res = child.querySelector(selector);
          if (res) return res;
        }
        return null;
      }
      if (selector.startsWith('.')) {
        const targetClass = selector.substring(1);
        if ((this.className || '').split(' ').includes(targetClass)) return this;
        for (const child of this.children) {
          const res = child.querySelector(selector);
          if (res) return res;
        }
        return null;
      }
      return null;
    }

    addEventListener(event, fn) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
    }

    click() {
      if (this.listeners['click']) {
        for (const fn of this.listeners['click']) fn();
      }
    }
  }

  const elementsById = new Map();
  const mockBody = new MockElement('body');

  globalThis.document = {
    body: mockBody,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elementsById.get(id) || null,
  };

  const vfs = new VFS();
  const modal = new SettingsModal(vfs);
  modal.show();

  const modalOverlay = mockBody.children.find(c => c.id === 'settings-modal');
  assert.ok(modalOverlay, 'Settings modal overlay must be created in document.body');
  elementsById.set('settings-modal', modalOverlay);

  // Verify upgrade button exists
  const btnUpgrade = modalOverlay.querySelector('#modal-upgrade-btn');
  assert.ok(btnUpgrade, '#modal-upgrade-btn must exist in modal-header-actions');

  // Click upgrade button to trigger confirmation dialog
  btnUpgrade.click();

  const confirmOverlay = modalOverlay.querySelector('#upgrade-confirm-overlay');
  assert.ok(confirmOverlay, '#upgrade-confirm-overlay must be displayed upon clicking upgrade button');

  const btnCancel = confirmOverlay.querySelector('#confirm-cancel-btn');
  assert.ok(btnCancel, '#confirm-cancel-btn must exist in confirmation dialog');

  // Cancel dismisses the dialog without reload
  btnCancel.click();
  const afterCancel = modalOverlay.querySelector('#upgrade-confirm-overlay');
  assert.strictEqual(afterCancel, null, 'Confirmation dialog must be removed upon clicking Cancel');

  console.log('✓ SettingsModal confirmation dialog open/cancel flow verified');
}

// 3. Test upgradeSystemFiles() cache purging logic
{
  let wasmCacheCleared = false;
  let cachesDeleted = [];
  let swUpdated = false;
  let reloadCalled = false;

  // Mock IndexedDB wasm-cache
  globalThis.indexedDB = {
    open: () => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              clear: () => {
                wasmCacheCleared = true;
                const r = {};
                setTimeout(() => r.onsuccess && r.onsuccess(), 0);
                return r;
              }
            })
          })
        },
        set onsuccess(cb) { setTimeout(() => cb({ target: this }), 0); },
        set onupgradeneeded(cb) {},
        set onerror(cb) {},
        set onblocked(cb) {}
      };
      return req;
    }
  };

  // Mock global caches (CacheStorage)
  globalThis.caches = {
    keys: async () => ['wasm-c-ide-cache-v1', 'other-cache'],
    delete: async (key) => {
      cachesDeleted.push(key);
      return true;
    }
  };

  // Mock ServiceWorker registration via Object.defineProperty
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: {
      getRegistration: async () => ({
        update: async () => {
          swUpdated = true;
        }
      })
    },
    configurable: true,
    writable: true
  });

  // Mock window.location.reload
  globalThis.window = {
    location: {
      reload: () => {
        reloadCalled = true;
      }
    }
  };

  await upgradeSystemFiles();

  assert.strictEqual(wasmCacheCleared, true, 'upgradeSystemFiles must clear IndexedDB wasm cache');
  assert.deepStrictEqual(cachesDeleted, ['wasm-c-ide-cache-v1', 'other-cache'], 'upgradeSystemFiles must delete all Service Worker caches');
  assert.strictEqual(swUpdated, true, 'upgradeSystemFiles must trigger ServiceWorker update');
  assert.strictEqual(reloadCalled, true, 'upgradeSystemFiles must trigger window.location.reload()');

  // Cleanup globals
  delete globalThis.document;
  delete globalThis.caches;
  delete globalThis.window;
  delete globalThis.indexedDB;
  delete globalThis.navigator.serviceWorker;

  console.log('✓ upgradeSystemFiles correctly purges wasm-cache and CacheStorage and initiates reload');
}

console.log('--- ALL PROJECT SETTINGS UPGRADE TESTS PASSED ---');
