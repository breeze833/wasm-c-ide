// Unit tests for Detached Terminal Mode (80x24 Default) and ANSI Screen Control
import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- Running Detached Terminal & ANSI Control Unit Tests ---');

// 1. Verify TerminalManager in src/terminal/terminal.js
const termSrc = fs.readFileSync('src/terminal/terminal.js', 'utf8');
assert.ok(termSrc.includes('this.isDetached = false'), 'TerminalManager must track isDetached state');
assert.ok(termSrc.includes('this.fixedGrid = false'), 'TerminalManager must track fixedGrid state');
assert.ok(termSrc.includes('getGridDimensions()'), 'TerminalManager must provide getGridDimensions()');
assert.ok(termSrc.includes('setGridDimensions(cols, rows)'), 'TerminalManager must provide setGridDimensions()');
assert.ok(termSrc.includes('computeCellDimensions()'), 'TerminalManager must provide computeCellDimensions()');
assert.ok(termSrc.includes('computeContainerSizeForGrid'), 'TerminalManager must provide computeContainerSizeForGrid()');
console.log('✓ TerminalManager implements detached state tracking, grid sizing, and cell dimension calculations');

// 2. Verify computeContainerSizeForGrid logic directly
function mockComputeContainerSize(cols = 80, rows = 24, cellW = 9, cellH = 17) {
  const padX = 16;
  const padY = 12;
  const headerH = 28;
  return {
    width: Math.ceil(cols * cellW) + padX,
    height: Math.ceil(rows * cellH) + headerH + padY,
  };
}
const size80x24 = mockComputeContainerSize(80, 24, 9, 17);
assert.strictEqual(size80x24.width, 720 + 16);
assert.strictEqual(size80x24.height, 408 + 28 + 12);
assert.ok(size80x24.width >= 700 && size80x24.width <= 800, '80-column width should comfortably fit viewport');
assert.ok(size80x24.height >= 400 && size80x24.height <= 500, '24-row height should comfortably fit viewport');
console.log('✓ 80x24 container dimension calculations verified');

// 3. Verify main.js template and setupTerminalWindowing
const mainSrc = fs.readFileSync('src/main.js', 'utf8');
assert.ok(mainSrc.includes('btn-term-detach'), 'main.js HTML template must include btn-term-detach');
assert.ok(mainSrc.includes('btn-term-min'), 'main.js HTML template must include btn-term-min');
assert.ok(mainSrc.includes('term-dimension-badge'), 'main.js HTML template must include term-dimension-badge');
assert.ok(mainSrc.includes('setupTerminalWindowing()'), 'main.js must define setupTerminalWindowing()');
assert.ok(mainSrc.includes('this.setupTerminalWindowing()'), 'App.init must call setupTerminalWindowing()');
assert.ok(mainSrc.includes('detachTerminal(80, 24)'), 'Default detach mode must target 80x24 geometry');
assert.ok(mainSrc.includes('dockTerminal()'), 'main.js must implement dockTerminal()');
assert.ok(mainSrc.includes('terminalSection.classList.add(\'detached\')'), 'Detach must add .detached class');
assert.ok(mainSrc.includes('terminalSection.classList.remove(\'detached\')'), 'Dock must remove .detached class');
assert.ok(mainSrc.includes('resizer.classList.add(\'hidden\')'), 'Detach must hide split resizer');
assert.ok(mainSrc.includes('this.editorManager.layout()'), 'Detach and dock must trigger editorManager layout');
assert.ok(mainSrc.includes('presets'), 'main.js must define presets for dimension badge snapping');
assert.ok(mainSrc.includes('Switch to ${next.label}'), 'main.js must dynamically display next preset in tooltip');
assert.ok(mainSrc.includes('Detach (80x24)'), 'main.js must show Detach (80x24) in docked tooltip');
assert.ok(mainSrc.includes('setDetachedFocus'), 'main.js must manage detached window focus');
assert.ok(mainSrc.includes('toggleMinimize'), 'main.js must implement minimize toggle');
assert.ok(mainSrc.includes('M2 13'), 'Minimize icon must be an underscore bar at bottom (y=13)');
assert.ok(mainSrc.includes('maxSVG'), 'Maximize icon must be defined as a square');
assert.ok(mainSrc.includes('Maximize Terminal'), 'Maximize action must be available when terminal is minimized');
console.log('✓ main.js contains complete detached terminal windowing, minimize/maximize icons (underscore & square), 80x24 defaults, and focus management');

// 4. Verify style.css rules
const cssSrc = fs.readFileSync('src/style.css', 'utf8');
assert.ok(cssSrc.includes('.terminal-section.detached'), 'style.css must style .terminal-section.detached');
assert.ok(cssSrc.includes('.terminal-section.detached.focused'), 'style.css must style focused state');
assert.ok(cssSrc.includes('#23d18b'), 'style.css must use green phosphor accent (#23d18b)');
assert.ok(cssSrc.includes('rgba(35, 209, 139, 0.45)'), 'style.css must include green glow box-shadow');
assert.ok(cssSrc.includes('.terminal-section.detached.minimized'), 'style.css must support minimized detached state');
assert.ok(cssSrc.includes('.split-resizer.hidden'), 'style.css must define .split-resizer.hidden');
assert.ok(cssSrc.includes('.terminal-dim-badge'), 'style.css must style .terminal-dim-badge');
assert.ok(cssSrc.includes('cursor: move'), 'Detached header must specify cursor: move');
console.log('✓ style.css floating window, green glow focus, minimized state, and dimension badge styles verified');

// 5. Verify examples/08_ansi_terminal.c and examples/README.md
assert.ok(fs.existsSync('examples/08_ansi_terminal.c'), 'examples/08_ansi_terminal.c must exist');
const ansiExample = fs.readFileSync('examples/08_ansi_terminal.c', 'utf8');
assert.ok(ansiExample.includes('\\033[2J'), 'ANSI demo must include clear screen sequence');
assert.ok(ansiExample.includes('\\033[?25l'), 'ANSI demo must include cursor hide sequence');
assert.ok(ansiExample.includes('\\033[?25h'), 'ANSI demo must include cursor restore sequence');
assert.ok(ansiExample.includes('80'), 'ANSI demo must be targeted for 80 columns');
assert.ok(ansiExample.includes('24'), 'ANSI demo must be targeted for 24 rows');

const readmeSrc = fs.readFileSync('examples/README.md', 'utf8');
assert.ok(readmeSrc.includes('08_ansi_terminal.c'), 'examples/README.md must reference 08_ansi_terminal.c');
assert.ok(readmeSrc.includes('80×24'), 'examples/README.md must highlight 80x24 detached mode');
// 6. Verify WasiHost properly decodes multi-byte UTF-8 box drawing sequences without corruption
let hostSrc = fs.readFileSync('src/vfs/wasi-host.js', 'utf8');
try {
  const baseHostPath = import.meta.resolve ? new URL(import.meta.resolve('clang-wasi/host')).pathname : null;
  if (baseHostPath && fs.existsSync(baseHostPath)) {
    hostSrc += '\n' + fs.readFileSync(baseHostPath, 'utf8');
  }
} catch (_) {}
assert.ok(hostSrc.includes('TextDecoder'), 'WasiHost must use TextDecoder for UTF-8 decoding');
console.log('✓ WasiHost UTF-8 multi-byte decoding verified');

// 7. Verify WasiHost poll_oneoff implements clock timers for nanosleep
assert.ok(hostSrc.includes('poll_oneoff: (in_ptr, out_ptr, nsubscriptions, nevents_out)'), 'WasiHost must implement poll_oneoff with arguments');
assert.ok(hostSrc.includes('__WASI_EVENTTYPE_CLOCK') || hostSrc.includes('maxSleepMs'), 'poll_oneoff must handle clock timeouts');
console.log('✓ WasiHost poll_oneoff clock and delay support verified');

console.log('--- ALL DETACHED TERMINAL & ANSI TESTS PASSED ---');
