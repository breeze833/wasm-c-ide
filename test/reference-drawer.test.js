// test/reference-drawer.test.js - Unit tests for ReferenceDrawer and Documentation System

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 1. Mock browser DOM environment if running in Node.js
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(cls) { this.classes.add(cls); }
  remove(cls) { this.classes.delete(cls); }
  toggle(cls, force) {
    if (force !== undefined) {
      if (force) this.classes.add(cls); else this.classes.delete(cls);
      return force;
    }
    if (this.classes.has(cls)) { this.classes.delete(cls); return false; }
    this.classes.add(cls); return true;
  }
  contains(cls) { return this.classes.has(cls); }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = '';
    this._className = '';
    this.classList = new MockClassList();
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this._innerHTML = '';
    this.eventListeners = new Map();
  }

  set className(name) {
    this._className = name;
    this.classList.classes = new Set((name || '').split(/\s+/).filter(Boolean));
  }

  get className() {
    return Array.from(this.classList.classes).join(' ');
  }

  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  hasAttribute(k) { return this.attributes.has(k); }

  addEventListener(event, fn) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(fn);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type || event) || [];
    for (const fn of listeners) fn(event);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set innerHTML(html) {
    this._innerHTML = html;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get textContent() {
    return this._innerHTML.replace(/<[^>]+>/g, ' ');
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const targetId = selector.slice(1);
      if (this.id === targetId) return this;
      return this._findChild(el => el.id === targetId);
    }
    if (selector.startsWith('.')) {
      const targetClass = selector.slice(1);
      if (this.classList.contains(targetClass)) return this;
      return this._findChild(el => el.classList.contains(targetClass));
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    this._collectChildren(el => {
      if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
      }
      return false;
    }, results);
    return results;
  }

  closest(selector) {
    if (selector.startsWith('.')) {
      if (this.classList.contains(selector.slice(1))) return this;
    }
    return null;
  }

  _findChild(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      if (child._findChild) {
        const found = child._findChild(predicate);
        if (found) return found;
      }
    }
    return null;
  }

  _collectChildren(predicate, results) {
    for (const child of this.children) {
      if (predicate(child)) results.push(child);
      if (child._collectChildren) child._collectChildren(predicate, results);
    }
  }
}

// Setup global mock document & window
globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    if (id === 'btn-reference') return globalThis.__btnReferenceMock;
    return null;
  }
};
globalThis.window = {
  addEventListener(event, fn) {
    if (!globalThis.__winListeners) globalThis.__winListeners = new Map();
    if (!globalThis.__winListeners.has(event)) globalThis.__winListeners.set(event, []);
    globalThis.__winListeners.get(event).push(fn);
  }
};

globalThis.__btnReferenceMock = new MockElement('button');
globalThis.__btnReferenceMock.id = 'btn-reference';

// Dynamic import of tested components
const { ReferenceDrawer, getDocsUrl } = await import('../src/components/reference.js');
const { buildDocs } = await import('../scripts/build-docs.js');

console.log('--- Running Reference Drawer & Documentation Subsystem Unit Tests ---');

// Test 1: getDocsUrl Relative Base Path Resolution
{
  const urlDefault = getDocsUrl();
  assert.strictEqual(urlDefault, './docs/index.html', 'Default getDocsUrl should resolve to ./docs/index.html');

  const urlSubpath = getDocsUrl('libc-wasi.html');
  assert.strictEqual(urlSubpath, './docs/libc-wasi.html', 'Subpath should resolve to ./docs/libc-wasi.html');
  console.log('✓ getDocsUrl relative URL resolution verified');
}

// Test 2: ReferenceDrawer DOM Initialization
{
  const container = new MockElement('div');
  container.className = 'main-layout';

  let openedExample = null;
  const drawer = new ReferenceDrawer({
    container,
    onOpenExample: (name, content) => { openedExample = { name, content }; }
  });

  assert.ok(drawer.drawerEl, 'ReferenceDrawer element should be created');
  assert.strictEqual(drawer.drawerEl.id, 'reference-drawer', 'Drawer ID should be reference-drawer');
  assert.ok(drawer.drawerEl.classList.contains('collapsed'), 'Drawer should start collapsed by default');

  // Verify external portal link
  assert.ok(drawer.drawerEl.innerHTML.includes('Open Full Documentation Portal'), 'Should render external portal link');
  assert.ok(drawer.drawerEl.innerHTML.includes('rel="noopener noreferrer"'), 'External link should have rel="noopener noreferrer"');
  assert.ok(drawer.drawerEl.innerHTML.includes('target="_blank"'), 'External link should have target="_blank"');
  console.log('✓ ReferenceDrawer DOM structure and security attributes verified');
}

// Test 3: Tab Rendering & Content Verification
{
  const container = new MockElement('div');
  const drawer = new ReferenceDrawer({ container, onOpenExample: () => {} });

  // 1. Libc tab
  const libcHtml = drawer.renderLibcTab();
  assert.ok(libcHtml.includes('General C Libc & WASI Restrictions'), 'Libc tab should document general restrictions');
  assert.ok(libcHtml.includes('fork()'), 'Libc tab should mention no fork/exec');
  assert.ok(libcHtml.includes('SIGKILL'), 'Libc tab should mention signals limitation');
  assert.ok(libcHtml.includes('poll_oneoff'), 'Libc tab should mention poll_oneoff clock sleep');

  // 2. Turtle tab
  const turtleHtml = drawer.renderTurtleTab();
  assert.ok(turtleHtml.includes('Turtle Graphics'), 'Turtle tab should document turtle');
  assert.ok(turtleHtml.includes('+Y (North / 90°)'), 'Turtle tab should have Cartesian coordinate diagram');
  assert.ok(turtleHtml.includes('turtle_forward'), 'Turtle tab should document turtle_forward');
  assert.ok(turtleHtml.includes('-lturtle'), 'Turtle tab should show linker flags');

  // 3. Canvas tab
  const canvasHtml = drawer.renderCanvasTab();
  assert.ok(canvasHtml.includes('Direct Software Framebuffer'), 'Canvas tab should document framebuffer');
  assert.ok(canvasHtml.includes('0xAABBGGRR'), 'Canvas tab should specify 0xAABBGGRR format');
  assert.ok(canvasHtml.includes('graphics_wait_frame'), 'Canvas tab should document graphics_wait_frame');

  // 4. Raylib tab
  const raylibHtml = drawer.renderRaylibTab();
  assert.ok(raylibHtml.includes('Raylib 5.5 WASI'), 'Raylib tab should document Raylib 5.5');
  assert.ok(raylibHtml.includes('WASI Preview 1 Restrictions Matrix'), 'Raylib tab should have restrictions matrix');
  assert.ok(raylibHtml.includes('Single-Threaded'), 'Raylib tab should state single-threaded status');
  assert.ok(raylibHtml.includes('raylib.com/cheatsheet/cheatsheet.html'), 'Raylib tab should link to official cheatsheet');

  // 5. SQLite tab
  const sqliteHtml = drawer.renderSqliteTab();
  assert.ok(sqliteHtml.includes('SQLite 3 WASI'), 'SQLite tab should document SQLite 3');
  assert.ok(sqliteHtml.includes(':memory:'), 'SQLite tab should document :memory: mode');
  assert.ok(sqliteHtml.includes('/workspace/*.db'), 'SQLite tab should document VFS persistence');
  assert.ok(sqliteHtml.includes('sqlite.org/c3ref/intro.html'), 'SQLite tab should link to official C API');
  console.log('✓ All 5 documentation tabs render complete specifications and WASI caveats');
}

// Test 4: Open, Close, and Toggle Operations
{
  const container = new MockElement('div');
  let toggledState = null;
  const drawer = new ReferenceDrawer({
    container,
    onOpenExample: () => {},
    onToggle: (isOpen) => { toggledState = isOpen; }
  });

  drawer.open('turtle');
  assert.strictEqual(drawer.isOpen, true, 'Drawer should be open');
  assert.strictEqual(drawer.activeTab, 'turtle', 'Active tab should be turtle');
  assert.strictEqual(drawer.drawerEl.classList.contains('collapsed'), false, 'collapsed class should be removed');
  assert.strictEqual(toggledState, true, 'onToggle should receive true');

  drawer.close();
  assert.strictEqual(drawer.isOpen, false, 'Drawer should be closed');
  assert.strictEqual(drawer.drawerEl.classList.contains('collapsed'), true, 'collapsed class should be present');
  assert.strictEqual(toggledState, false, 'onToggle should receive false');

  drawer.toggle('raylib');
  assert.strictEqual(drawer.isOpen, true, 'Toggle should open drawer');
  assert.strictEqual(drawer.activeTab, 'raylib', 'Active tab should be raylib');
  console.log('✓ Drawer open, close, and toggle transitions verified');
}

// Test 5: Standalone Documentation Generator (ide-docs/ -> dist/docs/)
{
  buildDocs();

  const expectedFiles = [
    'index.html',
    'libc-wasi.html',
    'turtle.html',
    'canvas.html',
    'raylib.html',
    'sqlite.html',
    'style.css',
    'highlighter.js'
  ];

  const distDocsDir = path.join(projectRoot, 'dist', 'docs');
  const publicDocsDir = path.join(projectRoot, 'public', 'docs');

  for (const file of expectedFiles) {
    const distPath = path.join(distDocsDir, file);
    const pubPath = path.join(publicDocsDir, file);
    assert.ok(fs.existsSync(distPath), `dist/docs/${file} must exist`);
    assert.ok(fs.existsSync(pubPath), `public/docs/${file} must exist`);

    const content = fs.readFileSync(distPath, 'utf8');
    assert.ok(content.length > 50, `dist/docs/${file} must not be empty`);

    if (file.endsWith('.html')) {
      // Check that back-to-IDE links use relative '../'
      assert.ok(content.includes('href="../"'), `${file} must contain relative link to IDE (href="../")`);
      // Check that syntax highlighter is loaded
      assert.ok(content.includes('highlighter.js'), `${file} must include highlighter.js`);
    }
  }

  console.log('✓ buildDocs outputs complete standalone documentation into dist/docs/ and public/docs/');
}

console.log('--- ALL REFERENCE DRAWER & DOCUMENTATION TESTS PASSED ---');
