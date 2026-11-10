// In-IDE Slide-Out Right Reference Drawer & Cheatsheet Subsystem

import { EXAMPLES_DATA } from './examples-data.js';

export function getDocsUrl(subpath = 'index.html') {
  let base = './';
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) {
    base = import.meta.env.BASE_URL;
  }
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanSub = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  return `${cleanBase}docs/${cleanSub}`;
}

export class ReferenceDrawer {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {Function} options.onOpenExample - (filename, content) => void
   * @param {Function} [options.onToggle] - (isOpen) => void
   */
  constructor({ container, onOpenExample, onToggle }) {
    this.container = container;
    this.onOpenExample = onOpenExample;
    this.onToggle = onToggle || (() => {});
    this.isOpen = false;
    this.activeTab = 'libc'; // 'libc' | 'turtle' | 'canvas' | 'raylib' | 'sqlite'

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    this.drawerEl = document.createElement('aside');
    this.drawerEl.id = 'reference-drawer';
    this.drawerEl.className = 'reference-drawer collapsed';
    this.drawerEl.setAttribute('aria-label', 'API Reference and Cheatsheets');

    const docsUrl = getDocsUrl();

    this.drawerEl.innerHTML = `
      <div class="reference-header">
        <div class="reference-title-bar">
          <div class="reference-title-group">
            <svg class="reference-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94 2.85 1.084 1.353 1.542.454 1.94A.5.5 0 0 0 0 2.404v10.518a.5.5 0 0 0 .66.473c.961-.36 2.37-.777 3.754-.918 1.13-.115 2.148.04 2.898.489.262.157.625.157.888 0 .75-.449 1.768-.604 2.898-.489 1.384.141 2.793.558 3.754.918a.5.5 0 0 0 .66-.473V2.404a.5.5 0 0 0-.454-.464c-.899-.398-2.396-.856-3.833-.999-1.3-.13-2.728-.004-3.713.842z"/>
            </svg>
            <span class="reference-title">Reference & Docs</span>
          </div>
          <button id="btn-close-reference" class="icon-btn reference-close-btn" title="Close Reference (Esc / Ctrl+Shift+H)" aria-label="Close Reference">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
        </div>

        <div class="reference-portal-banner">
          <a href="${docsUrl}" target="_blank" rel="noopener noreferrer" class="reference-portal-link" id="link-external-docs">
            <span>Open Full Documentation Portal</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
              <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
            </svg>
          </a>
        </div>

        <div class="reference-search-bar">
          <input type="text" id="reference-search-input" class="reference-search-input" placeholder="Filter functions, topics..." aria-label="Filter reference">
        </div>

        <nav class="reference-tabs" role="tablist">
          <button class="ref-tab active" data-tab="libc" role="tab" aria-selected="true">Libc / WASI</button>
          <button class="ref-tab" data-tab="turtle" role="tab" aria-selected="false">Turtle</button>
          <button class="ref-tab" data-tab="canvas" role="tab" aria-selected="false">Canvas 2D</button>
          <button class="ref-tab" data-tab="raylib" role="tab" aria-selected="false">Raylib</button>
          <button class="ref-tab" data-tab="sqlite" role="tab" aria-selected="false">SQLite 3</button>
        </nav>
      </div>

      <div class="reference-body" id="reference-content">
        <!-- Dynamic content injected here -->
      </div>
    `;

    this.container.appendChild(this.drawerEl);
    this.renderActiveTab();
  }

  bindEvents() {
    // Close button
    const btnClose = this.drawerEl.querySelector('#btn-close-reference');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.close());
    }

    // Tab buttons
    const tabButtons = this.drawerEl.querySelectorAll('.ref-tab');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Search filter
    const searchInput = this.drawerEl.querySelector('#reference-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterContent(e.target.value.toLowerCase().trim());
      });
    }

    // Global keyboard shortcut: Ctrl+Shift+H or F1
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) || e.key === 'F1') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Delegate "Load Example" buttons
    this.drawerEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-load-example');
      if (btn) {
        const exampleName = btn.getAttribute('data-example');
        if (exampleName && EXAMPLES_DATA[exampleName]) {
          this.onOpenExample(exampleName, EXAMPLES_DATA[exampleName]);
        }
      }
    });
  }

  toggle(tabName = null) {
    if (this.isOpen && (!tabName || tabName === this.activeTab)) {
      this.close();
    } else {
      this.open(tabName);
    }
  }

  open(tabName = null) {
    if (tabName && tabName !== this.activeTab) {
      this.switchTab(tabName);
    }
    this.isOpen = true;
    this.drawerEl.classList.remove('collapsed');
    const btnRef = document.getElementById('btn-reference');
    if (btnRef) btnRef.classList.add('active');

    this.onToggle(true);
  }

  close() {
    this.isOpen = false;
    this.drawerEl.classList.add('collapsed');
    const btnRef = document.getElementById('btn-reference');
    if (btnRef) btnRef.classList.remove('active');

    this.onToggle(false);
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    const tabButtons = this.drawerEl.querySelectorAll('.ref-tab');
    tabButtons.forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Reset search
    const searchInput = this.drawerEl.querySelector('#reference-search-input');
    if (searchInput) searchInput.value = '';

    this.renderActiveTab();
  }

  filterContent(query) {
    const sections = this.drawerEl.querySelectorAll('.ref-section, .ref-card');
    sections.forEach(sec => {
      if (!query) {
        sec.style.display = '';
        return;
      }
      const text = sec.textContent.toLowerCase();
      sec.style.display = text.includes(query) ? '' : 'none';
    });
  }

  renderActiveTab() {
    const container = this.drawerEl.querySelector('#reference-content');
    if (!container) return;

    switch (this.activeTab) {
      case 'libc':
        container.innerHTML = this.renderLibcTab();
        break;
      case 'turtle':
        container.innerHTML = this.renderTurtleTab();
        break;
      case 'canvas':
        container.innerHTML = this.renderCanvasTab();
        break;
      case 'raylib':
        container.innerHTML = this.renderRaylibTab();
        break;
      case 'sqlite':
        container.innerHTML = this.renderSqliteTab();
        break;
      default:
        container.innerHTML = '<p class="ref-empty">Tab not found.</p>';
    }

    container.scrollTop = 0;
  }

  renderLibcTab() {
    return `
      <div class="ref-tab-pane">
        <div class="ref-section">
          <h3>General C Libc & WASI Restrictions</h3>
          <p class="ref-desc">
            <code>wasm-c-ide</code> runs pure WebAssembly targeting <strong>WASI Preview 1 (wasm32-wasip1)</strong>. 
            Standard C library functions (<code class="badge">&lt;stdio.h&gt;</code>, <code class="badge">&lt;stdlib.h&gt;</code>, <code class="badge">&lt;string.h&gt;</code>, <code class="badge">&lt;math.h&gt;</code>) are fully supported, but OS-level kernels and hardware calls operate under specific WASI constraints.
          </p>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>1. Process Control (No fork / exec)</h4>
            <span class="ref-badge warning">WASI Limit</span>
          </div>
          <p>WebAssembly runs as an isolated sandbox instance. System calls creating kernel subprocesses are unavailable:</p>
          <ul class="ref-list">
            <li>❌ <strong>Unsupported:</strong> <code>fork()</code>, <code>execve()</code>, <code>waitpid()</code>, <code>system()</code>, <code>popen()</code>.</li>
            <li>✅ <strong>Alternative:</strong> Multi-process coordination, chaining (<code>&amp;&amp;</code>, <code>||</code>), and pipelines (<code>|</code>) are executed exclusively through the POSIX shell (<code>ash</code> / <code>busybox-wasi</code>).</li>
          </ul>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>2. Signals & Asynchronous Interrupts</h4>
            <span class="ref-badge warning">WASI Limit</span>
          </div>
          <p>WASI Preview 1 lacks asynchronous OS signal dispatching:</p>
          <ul class="ref-list">
            <li>❌ <strong>Unsupported:</strong> <code>SIGKILL</code>, <code>SIGTERM</code>, <code>SIGALRM</code>, <code>signal()</code>, <code>sigaction()</code> are stubbed or no-ops.</li>
            <li>✅ <strong>Alternative:</strong> Interactive process cancellation is performed cleanly via the terminal host bridge by pressing <kbd>Ctrl+C</kbd>, which terminates the active runtime Web Worker.</li>
          </ul>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>3. Networking & BSD Sockets</h4>
            <span class="ref-badge warning">WASI Limit</span>
          </div>
          <p>Network socket creation is disabled in pure single-threaded WASI Snapshot Preview 1:</p>
          <ul class="ref-list">
            <li>❌ <strong>Unsupported:</strong> <code>socket()</code>, <code>connect()</code>, <code>bind()</code>, <code>listen()</code>, <code>&lt;sys/socket.h&gt;</code>, <code>&lt;netdb.h&gt;</code>.</li>
            <li>✅ <strong>Supported:</strong> All in-browser communication is routed through client-side VFS, WebSockets, or host-assisted bridges.</li>
          </ul>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>4. Threading & Concurrency</h4>
            <span class="ref-badge warning">Single-Threaded</span>
          </div>
          <p>WASI Preview 1 compiles without <code>wasm32-wasi-threads</code>:</p>
          <ul class="ref-list">
            <li>❌ <strong>Unsupported:</strong> POSIX Threads (<code>&lt;pthread.h&gt;</code>), <code>pthread_create()</code>, mutex locks requiring shared memory kernels.</li>
            <li>✅ <strong>Supported:</strong> Single-threaded dormant mutexes are provided in <code>wasi-sdk &gt;= 26</code> libc++ headers so C++ <code>&lt;vector&gt;</code>, <code>&lt;string&gt;</code>, and <code>&lt;iostream&gt;</code> compile without errors.</li>
          </ul>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>5. File I/O & In-Memory VFS</h4>
            <span class="ref-badge success">Fully Supported</span>
          </div>
          <p>Complete standard C and C++ file I/O backed by our zero-overhead in-memory virtual filesystem:</p>
          <ul class="ref-list">
            <li>✅ <code>fopen()</code>, <code>fread()</code>, <code>fwrite()</code>, <code>fseek()</code>, <code>ftell()</code>, <code>fclose()</code>.</li>
            <li>✅ C++ <code>std::ifstream</code>, <code>std::ofstream</code>, <code>&lt;fstream&gt;</code>.</li>
            <li>✅ Real-time synchronization: Files modified by C code under <code>/workspace</code> immediately reflect in Monaco tabs and the sidebar file tree.</li>
            <li>⚠️ <strong>Locking:</strong> Advisory file locking (<code>fcntl(F_SETLK)</code>) is a safe no-op.</li>
          </ul>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>6. Synchronous Sleep & Timers</h4>
            <span class="ref-badge success">Fully Supported</span>
          </div>
          <p>Clock events in WASI <code>poll_oneoff</code> are parsed and paced synchronously via <code>Atomics.wait()</code> on <code>SharedArrayBuffer</code>:</p>
          <ul class="ref-list">
            <li>✅ <code>sleep(seconds)</code>, <code>usleep(usec)</code>, <code>nanosleep(&amp;ts, NULL)</code>.</li>
            <li>✅ Accurately pauses execution with zero CPU busy-looping.</li>
          </ul>
        </div>

        <div class="ref-action-footer">
          <button class="btn btn-primary btn-load-example" data-example="01_stdio.c">
            <span>Load Stdio &amp; File I/O Example</span>
          </button>
          <button class="btn btn-secondary btn-load-example" data-example="08_ansi_terminal.c">
            <span>Load ANSI Terminal Demo</span>
          </button>
        </div>
      </div>
    `;
  }

  renderTurtleTab() {
    return `
      <div class="ref-tab-pane">
        <div class="ref-section">
          <h3>Turtle Graphics (<code class="badge">&lt;turtle.h&gt;</code>)</h3>
          <p class="ref-desc">
            Logo-style turtle graphics built specifically for <code>wasm-c-ide</code>. Features a Cartesian coordinate system with center origin, smooth animation pacing, and swappable backends.
          </p>
        </div>

        <div class="ref-card">
          <h4>Coordinate System &amp; Heading</h4>
          <div class="ref-diagram">
<pre>
             +Y (North / 90°)
                    ▲
                    │
   -X (West / 180°) ┼ ───► +X (East / 0°)
                  (0,0)
                    │
                    ▼
             -Y (South / 270°)
</pre>
          </div>
          <ul class="ref-list">
            <li><strong>Origin (0, 0):</strong> Exact center of the canvas window.</li>
            <li><strong>Orientation:</strong> <code>+X</code> East, <code>+Y</code> North. Initial heading = <code>0°</code> (Facing East).</li>
            <li><strong>Turns:</strong> <code>turtle_turn_left(deg)</code> rotates counter-clockwise; <code>turtle_turn_right(deg)</code> rotates clockwise.</li>
          </ul>
        </div>

        <div class="ref-card">
          <h4>1. Lifecycle &amp; Canvas Control</h4>
          <div class="ref-api-item">
            <code>bool turtle_begin(void *ctx)</code>
            <p>Initializes turtle graphics with backend context. Expands via macro to enforce link-time backend resolution.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_end(void)</code>
            <p>Cleans up rendering resources and closes the turtle window.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_clear(uint32_t color)</code>
            <p>Clears the entire canvas surface with packed 32-bit RGBA color.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_home(void)</code>
            <p>Returns turtle to <code>(0, 0)</code> and resets heading to <code>0°</code> without clearing lines.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_delay(double ms)</code>
            <p>Pauses execution for <code>ms</code> milliseconds, flushes lines, and renders interactive progress.</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>2. Movement &amp; Turning</h4>
          <div class="ref-api-item">
            <code>void turtle_forward(double steps)</code>
            <p>Moves along current heading by <code>steps</code> pixels (positive = forward, negative = backward). Draws if pen is down.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_turn(double deg)</code>
            <p>Rotates heading by <code>deg</code> degrees following mathematical convention (CCW positive).</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_turn_left(double deg)</code> / <code>turtle_turn_right(double deg)</code>
            <p>Rotates heading counter-clockwise (left) or clockwise (right) by given degrees.</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>3. Pen &amp; Cursor Control</h4>
          <div class="ref-api-item">
            <code>void turtle_pen_down(void)</code> / <code>turtle_pen_up(void)</code>
            <p>Lowers or raises drawing pen. When raised, movement does not draw lines.</p>
          </div>
          <div class="ref-api-item">
            <code>int turtle_is_pen_down(void)</code>
            <p>Returns <code>1</code> if pen is lowered, <code>0</code> if raised.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_pen_stroke(double stroke)</code>
            <p>Sets line stroke width in pixels.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_pen_color(uint32_t color)</code>
            <p>Sets pen color (<code>0xRRGGBBAA</code>). Use <code>TURTLE_RGBA(r,g,b,a)</code> or standard color macros.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_pen(double stroke, uint32_t color, int is_down)</code>
            <p>Sets stroke width, color, and pen state in a single call.</p>
          </div>
          <div class="ref-api-item">
            <code>void turtle_set_visible(bool visible)</code> / <code>bool turtle_is_visible(void)</code>
            <p>Controls and queries stylized turtle cursor icon visibility.</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>4. State Inspection</h4>
          <div class="ref-api-item">
            <code>double turtle_get_x(void)</code> / <code>double turtle_get_y(void)</code>
            <p>Queries current coordinates relative to center origin <code>(0, 0)</code>.</p>
          </div>
          <div class="ref-api-item">
            <code>double turtle_get_heading(void)</code>
            <p>Queries current heading in degrees (<code>0.0°</code> = East, <code>90.0°</code> = North).</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>Backend Linker Flags</h4>
          <ul class="ref-list">
            <li><strong>Canvas-WASI Backend:</strong> <code>-lturtle</code> (uses <code>&lt;turtle_backend_canvas_wasi.h&gt;</code>)</li>
            <li><strong>Raylib Backend:</strong> <code>-lturtle_raylib -lraylib</code> (uses <code>&lt;turtle_backend_raylib.h&gt;</code>)</li>
          </ul>
        </div>

        <div class="ref-action-footer">
          <button class="btn btn-primary btn-load-example" data-example="06_turtle_canvas.c">
            <span>Load Turtle Canvas Demo</span>
          </button>
          <button class="btn btn-secondary btn-load-example" data-example="07_turtle_raylib.c">
            <span>Load Turtle Raylib Demo</span>
          </button>
        </div>
      </div>
    `;
  }

  renderCanvasTab() {
    return `
      <div class="ref-tab-pane">
        <div class="ref-section">
          <h3>Canvas 2D &amp; Framebuffer (<code class="badge">&lt;graphics.h&gt;</code>, <code class="badge">&lt;graphics_canvas.h&gt;</code>)</h3>
          <p class="ref-desc">
            Direct graphics support powered by <code>canvas-wasi</code>. Renders directly to HTML5 Canvas in the floating/dockable graphics console with zero external linker flags.
          </p>
        </div>

        <div class="ref-card">
          <h4>1. Direct Software Framebuffer (<code class="badge">&lt;graphics.h&gt;</code>)</h4>
          <p class="ref-desc">Manipulate raw 32-bit RGBA pixels in memory and present at 60 FPS:</p>
          <ul class="ref-list">
            <li><strong>Pixel Format:</strong> Little-endian 32-bit RGBA (<code>0xAABBGGRR</code>):
              <br><code>Byte 0: Red</code> | <code>Byte 1: Green</code> | <code>Byte 2: Blue</code> | <code>Byte 3: Alpha</code>
            </li>
          </ul>

          <div class="ref-api-item">
            <code>void graphics_init(int width, int height, const char *title)</code>
            <p>Initializes graphics window with specified buffer dimensions and window title.</p>
          </div>
          <div class="ref-api-item">
            <code>void graphics_present(const uint32_t *pixels)</code>
            <p>Transfers <code>width * height</code> 32-bit <code>0xAABBGGRR</code> pixel buffer directly to canvas.</p>
          </div>
          <div class="ref-api-item">
            <code>void graphics_present_rgba(const uint8_t *rgba, int width, int height)</code>
            <p>Presents a raw RGBA byte buffer with custom dimensions.</p>
          </div>
          <div class="ref-api-item">
            <code>void graphics_wait_frame(int target_fps)</code>
            <p>Synchronously paces loop to target FPS via host <code>Atomics.wait()</code>.</p>
          </div>
          <div class="ref-api-item">
            <code>bool graphics_should_close(void)</code> / <code>void graphics_close(void)</code>
            <p>Queries close request or programmatically closes graphics window.</p>
          </div>
          <div class="ref-api-item">
            <code>void graphics_get_mouse(int *x, int *y, int *buttons, int *wheel)</code>
            <p>Reads mouse coordinates, button bitmask (1=L, 2=M, 4=R), and scroll wheel delta.</p>
          </div>
          <div class="ref-api-item">
            <code>bool graphics_is_key_down(int key)</code>
            <p>Synchronously checks keyboard state (e.g. 27 for ESC, 32 for Space, 37-40 for Arrows).</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>Minimal Framebuffer Starter</h4>
          <pre class="ref-code"><code><span class="token-prep">#include</span> <span class="token-str">&lt;graphics.h&gt;</span>
<span class="token-prep">#include</span> <span class="token-str">&lt;stdint.h&gt;</span>

<span class="token-kw">int</span> <span class="token-fn">main</span>(<span class="token-kw">void</span>) {
    <span class="token-fn">graphics_init</span>(<span class="token-num">640</span>, <span class="token-num">480</span>, <span class="token-str">"Software Framebuffer"</span>);
    <span class="token-kw">static</span> <span class="token-type">uint32_t</span> fb[<span class="token-num">640</span> * <span class="token-num">480</span>];

    <span class="token-kw">while</span> (!<span class="token-fn">graphics_should_close</span>()) {
        <span class="token-kw">for</span> (<span class="token-kw">int</span> i = <span class="token-num">0</span>; i &lt; <span class="token-num">640</span> * <span class="token-num">480</span>; i++) {
            fb[i] = <span class="token-num">0xFFFF8000</span>; <span class="token-comment">// 32-bit RGBA (orange)</span>
        }
        <span class="token-fn">graphics_present</span>(fb);
        <span class="token-fn">graphics_wait_frame</span>(<span class="token-num">60</span>);
    }

    <span class="token-fn">graphics_close</span>();
    <span class="token-kw">return</span> <span class="token-num">0</span>;
}</code></pre>
        </div>

        <div class="ref-card">
          <h4>2. HTML5 2D Vector Primitives (<code class="badge">&lt;graphics_canvas.h&gt;</code>)</h4>
          <div class="ref-api-item">
            <code>void canvas_present(void)</code>
            <p>Flushes and presents rendered 2D vector commands to display canvas, preserving buffer contents.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_fill_rect(x, y, w, h)</code> / <code>canvas_stroke_rect(...)</code> / <code>canvas_clear_rect(...)</code>
            <p>Fills, strokes, or clears rectangular areas.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_begin_path(void)</code> / <code>canvas_close_path(void)</code>
            <p>Starts new path or closes active subpath.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_move_to(x, y)</code> / <code>canvas_line_to(x, y)</code>
            <p>Moves path cursor or adds straight line segment.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_arc(x, y, radius, start_angle, end_angle, ccw)</code>
            <p>Adds circular arc to path with given radius and radian angles.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_fill(void)</code> / <code>canvas_stroke(void)</code>
            <p>Fills or strokes the current path using active styles.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_set_fill_style(style)</code> / <code>canvas_set_stroke_style(style)</code>
            <p>Sets color using CSS syntax (e.g. <code>"#ff5722"</code>, <code>"rgba(0,255,100,0.8)"</code>).</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_set_fill_rgb(r, g, b)</code> / <code>canvas_set_line_width(w)</code> / <code>canvas_set_line_cap(cap)</code>
            <p>Convenience RGB color and stroke line styling (<code>"butt"</code>, <code>"round"</code>, <code>"square"</code>).</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_fill_text(text, x, y)</code> / <code>canvas_stroke_text(...)</code> / <code>canvas_set_font(...)</code>
            <p>Draws text using CSS font string (e.g. <code>"bold 20px monospace"</code>).</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_save(void)</code> / <code>canvas_restore(void)</code>
            <p>Pushes or pops transformation matrix and style state stack.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_translate(x, y)</code> / <code>canvas_rotate(rad)</code> / <code>canvas_scale(sx, sy)</code>
            <p>Applies 2D affine matrix transformations.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_get_pixels(out)</code> / <code>canvas_put_pixels(in)</code>
            <p>Reads or writes full canvas <code>width * height</code> pixel buffer (<code>0xAABBGGRR</code>).</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_get_pixel(x, y)</code> / <code>canvas_set_pixel(x, y, color)</code>
            <p>Reads or writes single 32-bit pixel at coordinate <code>(x, y)</code>.</p>
          </div>
          <div class="ref-api-item">
            <code>canvas_get_image_data(...)</code> / <code>canvas_put_image_data(...)</code>
            <p>Sub-rectangle pixel transfers between 2D canvas and memory buffers.</p>
          </div>
        </div>

        <div class="ref-action-footer">
          <button class="btn btn-primary btn-load-example" data-example="03_framebuffer_graphics.c">
            <span>Load Framebuffer Plasma</span>
          </button>
          <button class="btn btn-secondary btn-load-example" data-example="04_canvas_vector.c">
            <span>Load 2D Vector Balls</span>
          </button>
          <button class="btn btn-secondary btn-load-example" data-example="05_canvas_pixels.c">
            <span>Load Canvas Filters</span>
          </button>
        </div>
      </div>
    `;
  }

  renderRaylibTab() {
    return `
      <div class="ref-tab-pane">
        <div class="ref-section">
          <h3>Raylib 5.5 WASI (<code class="badge">&lt;raylib.h&gt;</code>)</h3>
          <p class="ref-desc">
            Full-featured 2D/3D game development library compiled for pure WebAssembly Preview 1 via WebGL ES 2.0 and Web Audio.
          </p>
        </div>

        <div class="ref-card">
          <div class="ref-card-header">
            <h4>WASI Preview 1 Restrictions Matrix</h4>
            <span class="ref-badge warning">Important</span>
          </div>
          <table class="ref-table">
            <thead>
              <tr><th>Subsystem</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Threading</strong></td>
                <td><span class="status-no">Single-Threaded</span></td>
                <td>No <code>pthreads</code>. All drawing and game logic runs on single thread.</td>
              </tr>
              <tr>
                <td><strong>Frame Pacing</strong></td>
                <td><span class="status-yes">Clamped 60 FPS</span></td>
                <td><code>SetTargetFPS(60)</code> clamped via host <code>WaitTime()</code> using <code>Atomics.wait()</code>.</td>
              </tr>
              <tr>
                <td><strong>Web Audio</strong></td>
                <td><span class="status-yes">Supported</span></td>
                <td>Procedural &amp; streaming audio via <code>raudio_wasi.c</code> proxied to browser <code>AudioContext</code>.</td>
              </tr>
              <tr>
                <td><strong>GUI (raygui)</strong></td>
                <td><span class="status-yes">Supported</span></td>
                <td>Immediate-mode GUI with <code>#define RAYGUI_IMPLEMENTATION</code> in <code>&lt;raygui.h&gt;</code>.</td>
              </tr>
              <tr>
                <td><strong>Unsupported</strong></td>
                <td><span class="status-no">Disabled</span></td>
                <td>Native GLFW window pointers, OS drag-and-drop, and network sockets.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="ref-card">
          <h4>Minimal Starter Template</h4>
          <pre class="ref-code"><code><span class="token-prep">#include</span> <span class="token-str">"raylib.h"</span>

<span class="token-kw">int</span> <span class="token-fn">main</span>(<span class="token-kw">void</span>) {
    <span class="token-fn">InitWindow</span>(<span class="token-num">800</span>, <span class="token-num">450</span>, <span class="token-str">"Raylib WASI"</span>);
    <span class="token-fn">SetTargetFPS</span>(<span class="token-num">60</span>);

    <span class="token-kw">while</span> (!<span class="token-fn">WindowShouldClose</span>()) {
        <span class="token-fn">BeginDrawing</span>();
        <span class="token-fn">ClearBackground</span>(RAYWHITE);
        <span class="token-fn">DrawText</span>(<span class="token-str">"Hello Raylib on WebAssembly!"</span>, <span class="token-num">190</span>, <span class="token-num">200</span>, <span class="token-num">20</span>, LIGHTGRAY);
        <span class="token-fn">EndDrawing</span>();
    }

    <span class="token-fn">CloseWindow</span>();
    <span class="token-kw">return</span> <span class="token-num">0</span>;
}</code></pre>
        </div>

        <div class="ref-card">
          <h4>Compilation &amp; Official Cheatsheet</h4>
          <p>Linker flags: <code class="badge">-lraylib</code></p>
          <p>Upstream cheatsheet: <a href="https://www.raylib.com/cheatsheet/cheatsheet.html" target="_blank" rel="noopener noreferrer" class="ref-external-link">raylib.com/cheatsheet/cheatsheet.html ↗</a></p>
        </div>

        <div class="ref-action-footer">
          <button class="btn btn-primary btn-load-example" data-example="02_raylib_interactive.c">
            <span>Load Raylib Interactive Demo</span>
          </button>
          <button class="btn btn-secondary btn-load-example" data-example="10_raylib_gui_audio.c">
            <span>Load GUI &amp; Audio Synthesizer</span>
          </button>
        </div>
      </div>
    `;
  }

  renderSqliteTab() {
    return `
      <div class="ref-tab-pane">
        <div class="ref-section">
          <h3>SQLite 3 WASI (<code class="badge">&lt;sqlite3.h&gt;</code>)</h3>
          <p class="ref-desc">
            Self-contained, serverless SQL database engine compiled for WASI Preview 1 with in-memory tables and VFS file persistence.
          </p>
        </div>

        <div class="ref-card">
          <h4>Database Modes</h4>
          <ul class="ref-list">
            <li><strong>In-Memory Database:</strong> <code>sqlite3_open(":memory:", &amp;db);</code><br>Ultra-fast transient database that resides entirely in RAM.</li>
            <li><strong>VFS File Persistence (/workspace/*.db):</strong> <code>sqlite3_open("/workspace/app.db", &amp;db);</code><br>Stores database directly inside the VFS workspace, persisting across sessions in browser IndexedDB.</li>
          </ul>
        </div>

        <div class="ref-card">
          <h4>Core C API Flow</h4>
          <div class="ref-api-item">
            <code>sqlite3_open_v2(path, &amp;db, flags, NULL)</code>
            <p>Opens connection to database file or <code>:memory:</code>.</p>
          </div>
          <div class="ref-api-item">
            <code>sqlite3_prepare_v2(db, sql, -1, &amp;stmt, NULL)</code>
            <p>Compiles SQL statement into byte-code program.</p>
          </div>
          <div class="ref-api-item">
            <code>sqlite3_bind_int / text / double(...)</code>
            <p>Binds values to parameterized queries (<code>?</code> or <code>:param</code>).</p>
          </div>
          <div class="ref-api-item">
            <code>sqlite3_step(stmt)</code>
            <p>Advances statement execution. Returns <code>SQLITE_ROW</code> for query rows, or <code>SQLITE_DONE</code> on completion.</p>
          </div>
          <div class="ref-api-item">
            <code>sqlite3_column_text / int / double(stmt, col)</code>
            <p>Retrieves column values from the active row.</p>
          </div>
          <div class="ref-api-item">
            <code>sqlite3_finalize(stmt)</code> / <code>sqlite3_close_v2(db)</code>
            <p>Frees statement and closes database connection.</p>
          </div>
        </div>

        <div class="ref-card">
          <h4>Interactive Shell CLI</h4>
          <p>Run the genuine SQLite CLI applet directly inside the terminal:</p>
          <pre class="ref-code"><code>$ sqlite3 /workspace/demo.db
sqlite> CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
sqlite> INSERT INTO users (name) VALUES ('Alice'), ('Bob');
sqlite> SELECT * FROM users;
sqlite> .tables
sqlite> .quit</code></pre>
        </div>

        <div class="ref-card">
          <h4>Compilation &amp; Official Reference</h4>
          <p>Linker flags: <code class="badge">-lsqlite3</code></p>
          <p>Upstream documentation: <a href="https://www.sqlite.org/c3ref/intro.html" target="_blank" rel="noopener noreferrer" class="ref-external-link">sqlite.org/c3ref/intro.html ↗</a></p>
        </div>

        <div class="ref-action-footer">
          <button class="btn btn-primary btn-load-example" data-example="09_sqlite_database.c">
            <span>Load SQLite C Database Demo</span>
          </button>
        </div>
      </div>
    `;
  }
}
