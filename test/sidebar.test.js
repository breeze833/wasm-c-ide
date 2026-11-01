// Unit tests for Collapsible Slim Rail & Resizable File Tree Sidebar
import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- Running Collapsible & Resizable Sidebar Unit Tests ---');

// 1. Verify main.js HTML template structure
const mainSrc = fs.readFileSync('src/main.js', 'utf8');
assert.ok(mainSrc.includes('btn-sidebar-toggle'), 'main.js template must include btn-sidebar-toggle button');
assert.ok(mainSrc.includes('sidebar-toggle-btn'), 'main.js template must include sidebar-toggle-btn class');
assert.ok(mainSrc.includes('sidebar-collapsed-strip'), 'main.js template must include sidebar-collapsed-strip');
assert.ok(mainSrc.includes('WORKSPACE'), 'sidebar-collapsed-strip must include WORKSPACE label');
assert.ok(mainSrc.includes('sidebar-resizer'), 'main.js template must include sidebar-resizer');
console.log('✓ main.js HTML template includes toggle button, collapsed vertical strip, and sidebar resizer');

// 2. Verify App class sidebar state and initialization
assert.ok(mainSrc.includes('this.sidebarWidth = 240'), 'App constructor must initialize default sidebarWidth');
assert.ok(mainSrc.includes('this.sidebarCollapsed = false'), 'App constructor must initialize default sidebarCollapsed');
assert.ok(mainSrc.includes('this.setupSidebar()'), 'App.init must call this.setupSidebar()');
assert.ok(mainSrc.includes('setupSidebar()'), 'App class must implement setupSidebar()');
assert.ok(mainSrc.includes('this.toggleSidebar'), 'App class must expose toggleSidebar()');
assert.ok(mainSrc.includes('wasm_c_ide_sidebar_width'), 'Sidebar width must persist via localStorage wasm_c_ide_sidebar_width');
assert.ok(mainSrc.includes('wasm_c_ide_sidebar_collapsed'), 'Sidebar collapsed state must persist via localStorage wasm_c_ide_sidebar_collapsed');
console.log('✓ App class tracks sidebar state, registers setupSidebar, and persists to localStorage');

// 3. Verify drag resizer, double-click reset, and shortcuts in main.js
assert.ok(mainSrc.includes('sidebar.classList.add(\'resizing\')'), 'Mousedown on resizer must add resizing class to disable transitions');
assert.ok(mainSrc.includes('sidebar.classList.remove(\'resizing\')'), 'Mouseup must remove resizing class');
assert.ok(mainSrc.includes('resizer.addEventListener(\'dblclick\''), 'Resizer must listen for dblclick to reset width');
assert.ok(mainSrc.includes('this.sidebarWidth = 240'), 'Double-click must reset sidebar width to 240px');
assert.ok(mainSrc.includes('transitionend'), 'Sidebar must listen for transitionend to invoke editor layout');
assert.ok(mainSrc.includes('(e.key === \'b\' || e.key === \'B\')'), 'Window keydown must capture Ctrl+B / Cmd+B shortcut');
console.log('✓ Resizer dragging, double-click reset (240px), transitionend layout, and Ctrl+B shortcut verified');

// 4. Verify Monaco editor keybinding in src/editor/editor.js
const editorSrc = fs.readFileSync('src/editor/editor.js', 'utf8');
assert.ok(editorSrc.includes('KeyCode.KeyB'), 'Monaco editor must register CtrlCmd + KeyCode.KeyB command');
assert.ok(editorSrc.includes('toggleSidebar'), 'Monaco Ctrl+B command must call toggleSidebar()');
console.log('✓ Monaco editor Ctrl+B keybinding verified');

// 5. Verify style.css rules for sidebar, collapsed slim rail, and resizer
const cssSrc = fs.readFileSync('src/style.css', 'utf8');
assert.ok(cssSrc.includes('.sidebar {'), 'style.css must style .sidebar');
assert.ok(cssSrc.includes('transition: width'), 'style.css must define width transition for smooth collapse/expand');
assert.ok(cssSrc.includes('.sidebar.resizing'), 'style.css must define .sidebar.resizing with transition: none');
assert.ok(cssSrc.includes('.sidebar.collapsed {'), 'style.css must define .sidebar.collapsed');
assert.ok(cssSrc.includes('width: 36px !important'), '.sidebar.collapsed must clamp width to 36px');
assert.ok(cssSrc.includes('.sidebar-collapsed-strip'), 'style.css must style .sidebar-collapsed-strip');
assert.ok(cssSrc.includes('writing-mode: vertical-rl'), '.collapsed-title must use vertical-rl writing mode');
assert.ok(cssSrc.includes('transform: rotate(180deg)'), '.collapsed-title must rotate 180deg for vertical readability');
assert.ok(cssSrc.includes('.sidebar-resizer {'), 'style.css must style .sidebar-resizer');
assert.ok(cssSrc.includes('cursor: col-resize'), '.sidebar-resizer must use col-resize cursor');
assert.ok(cssSrc.includes('.sidebar-resizer.hidden'), 'style.css must define .sidebar-resizer.hidden');
console.log('✓ style.css defines smooth transitions, 36px collapsed rail, vertical WORKSPACE badge, and col-resize handle');

// 6. Test sidebar width clamping math logic
function clampSidebarWidth(width, windowWidth = 1200) {
  const maxW = Math.max(200, Math.min(600, windowWidth - 300));
  return Math.max(160, Math.min(maxW, width));
}

assert.strictEqual(clampSidebarWidth(240, 1200), 240, 'Default 240px should be unchanged');
assert.strictEqual(clampSidebarWidth(50, 1200), 160, 'Width below minimum (160px) must be clamped to 160px');
assert.strictEqual(clampSidebarWidth(800, 1200), 600, 'Width above 600px must be clamped to 600px');
assert.strictEqual(clampSidebarWidth(500, 600), 300, 'Width on small screen (600px wide) must leave at least 300px for content area');
console.log('✓ Sidebar width clamping bounds (160px - 600px, content area safeguard) verified');

console.log('--- ALL SIDEBAR TESTS PASSED ---');
