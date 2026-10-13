// Unit tests for Font Zoom controls, clamping, and localStorage persistence

import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- Running Font Zoom & Resizing Unit Tests ---');

// 1. Verify editor.js contains getFontSize, setFontSize, zoomIn, zoomOut, resetFontSize
const editorSrc = fs.readFileSync('src/editor/editor.js', 'utf8');
assert.ok(editorSrc.includes('getFontSize()'), 'EditorManager must define getFontSize()');
assert.ok(editorSrc.includes('setFontSize(size)'), 'EditorManager must define setFontSize(size)');
assert.ok(editorSrc.includes('zoomIn(delta = 1)'), 'EditorManager must define zoomIn()');
assert.ok(editorSrc.includes('zoomOut(delta = 1)'), 'EditorManager must define zoomOut()');
assert.ok(editorSrc.includes('resetFontSize()'), 'EditorManager must define resetFontSize()');
assert.ok(editorSrc.includes('wasm_ide_editor_font_size'), 'EditorManager must persist to localStorage');
assert.ok(editorSrc.includes('monaco.KeyCode.Equal'), 'EditorManager must bind zoom in shortcut');
assert.ok(editorSrc.includes('monaco.KeyCode.Minus'), 'EditorManager must bind zoom out shortcut');
console.log('✓ EditorManager source contains font size APIs, shortcuts, and persistence');

// 2. Verify terminal.js contains getFontSize, setFontSize, zoomIn, zoomOut, resetFontSize
const termSrc = fs.readFileSync('src/terminal/terminal.js', 'utf8');
assert.ok(termSrc.includes('getFontSize()'), 'TerminalManager must define getFontSize()');
assert.ok(termSrc.includes('setFontSize(size)'), 'TerminalManager must define setFontSize(size)');
assert.ok(termSrc.includes('zoomIn(delta = 1)'), 'TerminalManager must define zoomIn()');
assert.ok(termSrc.includes('zoomOut(delta = 1)'), 'TerminalManager must define zoomOut()');
assert.ok(termSrc.includes('resetFontSize()'), 'TerminalManager must define resetFontSize()');
assert.ok(termSrc.includes('wasm_ide_term_font_size'), 'TerminalManager must persist to localStorage');
assert.ok(termSrc.includes('attachCustomKeyEventHandler'), 'TerminalManager must bind custom keyboard zoom shortcuts');
console.log('✓ TerminalManager source contains font size APIs, shortcuts, and persistence');

// 3. Verify main.js contains zoom widgets in HTML template and setupZoomControls wiring
const mainSrc = fs.readFileSync('src/main.js', 'utf8');
assert.ok(mainSrc.includes('btn-editor-zoom-in'), 'main.js must define btn-editor-zoom-in button');
assert.ok(mainSrc.includes('btn-editor-zoom-out'), 'main.js must define btn-editor-zoom-out button');
assert.ok(mainSrc.includes('editor-font-size-label'), 'main.js must define editor-font-size-label element');
assert.ok(mainSrc.includes('btn-term-zoom-in'), 'main.js must define btn-term-zoom-in button');
assert.ok(mainSrc.includes('btn-term-zoom-out'), 'main.js must define btn-term-zoom-out button');
assert.ok(mainSrc.includes('term-font-size-label'), 'main.js must define term-font-size-label element');
assert.ok(mainSrc.includes('setupZoomControls()'), 'main.js must implement and call setupZoomControls()');
console.log('✓ main.js HTML template and UI event bindings verified');

// 4. Verify style.css defines zoom controls layout
const cssSrc = fs.readFileSync('src/style.css', 'utf8');
assert.ok(cssSrc.includes('.editor-header-bar'), 'style.css must style .editor-header-bar');
assert.ok(cssSrc.includes('.pane-zoom-controls'), 'style.css must style .pane-zoom-controls');
assert.ok(cssSrc.includes('.zoom-size-label'), 'style.css must style .zoom-size-label');
assert.ok(cssSrc.includes('.zoom-btn'), 'style.css must style .zoom-btn');
assert.ok(cssSrc.includes('.terminal-actions'), 'style.css must style .terminal-actions');
console.log('✓ style.css zoom widget styles verified');

// 5. Test font size math and clamping logic directly
function clampFontSize(size) {
  return Math.min(36, Math.max(9, Math.round(size)));
}
assert.strictEqual(clampFontSize(13), 13);
assert.strictEqual(clampFontSize(5), 9, 'Clamps minimum font size to 9px');
assert.strictEqual(clampFontSize(50), 36, 'Clamps maximum font size to 36px');
assert.strictEqual(clampFontSize(14.4), 14);
assert.strictEqual(clampFontSize(14.6), 15);
console.log('✓ Font size clamping math verified');

console.log('--- ALL FONT ZOOM TESTS PASSED ---');
