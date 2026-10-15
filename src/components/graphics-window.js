// Graphics Window Component for Raylib Canvas
// Handles in-page floating window, dragging, bitmap rendering, input listeners, and window pop-out

export class GraphicsWindowUI {
  constructor(options = {}) {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.titleText = null;
    this.resBadge = null;
    this.fpsBadge = null;
    this.popupWindow = null;
    this.popupCanvas = null;
    this.popupCtx = null;
    this.isPoppedOut = false;
    this.isMinimized = false;
    this.width = 800;
    this.height = 450;
    this.title = 'Raylib Display';

    this.onCloseRequested = options.onCloseRequested || (() => {});
    this.onFocusChange = options.onFocusChange || (() => {});
    this.sharedBuffer = options.sharedBuffer || null;
    this.inputCoordinator = options.inputCoordinator || null;

    this.initDOM();
  }

  initDOM() {
    let el = document.getElementById('graphics-window');
    if (!el) {
      el = document.createElement('div');
      el.id = 'graphics-window';
      el.className = 'graphics-window';
      document.body.appendChild(el);
    }
    el.style.display = 'none';
    this.container = el;

    this.container.innerHTML = `
      <div class="graphics-header" id="graphics-header">
        <div class="graphics-title">
          <span class="graphics-icon">🎮</span>
          <span id="graphics-title-text">${this.title}</span>
          <span class="graphics-badge" id="graphics-res-badge">${this.width}x${this.height}</span>
          <span class="graphics-badge fps-badge" id="graphics-fps-badge">60 FPS</span>
        </div>
        <div class="graphics-actions">
          <button id="btn-graphics-popout" class="graphics-btn" title="Pop out into separate window" data-tooltip="Pop Out Window">↗</button>
          <button id="btn-graphics-min" class="graphics-btn" title="Minimize" data-tooltip="Minimize">_</button>
          <button id="btn-graphics-close" class="graphics-btn" title="Close Window" data-tooltip="Close">&times;</button>
        </div>
      </div>
      <div class="graphics-body" id="graphics-body">
        <canvas id="raylib-canvas" width="${this.width}" height="${this.height}" tabindex="0"></canvas>
      </div>
    `;

    this.canvas = this.container.querySelector('#raylib-canvas');
    try {
      this.ctx = this.canvas.getContext('bitmaprenderer');
    } catch (_) {
      this.ctx = null;
    }
    if (!this.ctx && typeof this.canvas.getContext === 'function') {
      try {
        this.ctx = this.canvas.getContext('2d');
      } catch (_) {}
    }
    this.titleText = this.container.querySelector('#graphics-title-text');
    this.resBadge = this.container.querySelector('#graphics-res-badge');
    this.fpsBadge = this.container.querySelector('#graphics-fps-badge');

    // Attach dragging
    this.setupDraggable();

    // Attach actions
    this.container.querySelector('#btn-graphics-close').addEventListener('click', () => {
      this.close();
    });

    this.container.querySelector('#btn-graphics-min').addEventListener('click', () => {
      this.toggleMinimize();
    });

    this.container.querySelector('#btn-graphics-popout').addEventListener('click', () => {
      this.togglePopOut();
    });

    // Canvas focus / blur events
    this.canvas.addEventListener('focus', () => {
      this.container.classList.add('focused');
      this.onFocusChange(true);
    });

    this.canvas.addEventListener('blur', () => {
      this.container.classList.remove('focused');
      this.onFocusChange(false);
    });

    // If input coordinator was provided, attach listeners
    if (this.inputCoordinator && typeof this.inputCoordinator.attachListeners === 'function') {
      this.inputCoordinator.attachListeners(this.canvas);
    }
  }

  setInputCoordinator(inputCoordinator) {
    this.inputCoordinator = inputCoordinator;
    if (this.inputCoordinator && typeof this.inputCoordinator.attachListeners === 'function') {
      this.inputCoordinator.attachListeners(this.isPoppedOut && this.popupCanvas ? this.popupCanvas : this.canvas);
    }
  }

  setupDraggable() {
    const header = this.container.querySelector('#graphics-header');
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = this.container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      // Bring to front
      this.container.style.zIndex = '1000';

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        this.container.style.left = `${Math.max(10, initialLeft + dx)}px`;
        this.container.style.top = `${Math.max(10, initialTop + dy)}px`;
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  initWindow(width, height, title) {
    this.width = width || 800;
    this.height = height || 450;
    this.title = title || 'Raylib Display';

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.titleText.textContent = this.title;
    this.resBadge.textContent = `${this.width}x${this.height}`;

    if (this.popupWindow && !this.popupWindow.closed && this.popupCanvas) {
      this.popupCanvas.width = this.width;
      this.popupCanvas.height = this.height;
      this.popupWindow.document.title = `${this.title} (${this.width}x${this.height})`;
    }

    this.show();
    this.canvas.focus();
  }

  open(width, height, title) {
    if (this.inputCoordinator && typeof this.inputCoordinator.reset === 'function') {
      this.inputCoordinator.reset();
    }
    this.initWindow(width || this.width, height || this.height, title || this.title);
  }

  isOpen() {
    if (this.isPoppedOut && this.popupWindow && !this.popupWindow.closed) {
      return true;
    }
    return Boolean(this.container && this.container.style.display !== 'none');
  }

  show() {
    if (this.isPoppedOut && this.popupWindow && !this.popupWindow.closed) {
      this.popupWindow.focus();
      return;
    }
    this.container.style.display = 'flex';
    this.isMinimized = false;
    this.container.classList.remove('minimized');
  }

  hide() {
    this.container.style.display = 'none';
  }

  close() {
    this.hide();
    if (this.popupWindow && !this.popupWindow.closed) {
      this.popupWindow.close();
      this.popupWindow = null;
    }
    this.isPoppedOut = false;
    if (this.inputCoordinator && typeof this.inputCoordinator.reset === 'function') {
      this.inputCoordinator.reset();
    }
    this.onCloseRequested();
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    if (this.isMinimized) {
      this.container.classList.add('minimized');
    } else {
      this.container.classList.remove('minimized');
    }
  }

  togglePopOut() {
    if (this.isPoppedOut && this.popupWindow && !this.popupWindow.closed) {
      this.dockBack();
    } else {
      this.popOut();
    }
  }

  popOut() {
    const popWidth = Math.max(640, this.width + 32);
    const popHeight = Math.max(480, this.height + 64);

    try {
      this.popupWindow = window.open(
        '',
        'RaylibDisplay',
        `width=${popWidth},height=${popHeight},menubar=no,toolbar=no,location=no,status=no`
      );
    } catch {
      this.popupWindow = null;
    }

    if (!this.popupWindow) {
      console.warn('[GraphicsWindow] Popup window was blocked. Keeping in-page display.');
      return;
    }

    this.isPoppedOut = true;
    this.hide();

    this.popupWindow.document.title = `${this.title} - Raylib Display`;
    this.popupWindow.document.body.style.margin = '0';
    this.popupWindow.document.body.style.backgroundColor = '#1e1e1e';
    this.popupWindow.document.body.style.color = '#cccccc';
    this.popupWindow.document.body.style.fontFamily = 'system-ui, sans-serif';
    this.popupWindow.document.body.style.display = 'flex';
    this.popupWindow.document.body.style.flexDirection = 'column';
    this.popupWindow.document.body.style.alignItems = 'center';
    this.popupWindow.document.body.style.justifyContent = 'center';
    this.popupWindow.document.body.style.height = '100vh';
    this.popupWindow.document.body.style.overflow = 'hidden';

    this.popupWindow.document.body.innerHTML = `
      <div style="position: absolute; top: 8px; left: 12px; font-size: 13px; font-weight: bold; color: #9cdcfe; display: flex; gap: 8px; align-items: center;">
        <span>🎮 ${this.title}</span>
        <span style="font-size: 11px; background: #333; padding: 2px 6px; border-radius: 4px; color: #888;">${this.width}x${this.height}</span>
      </div>
      <div style="position: absolute; top: 8px; right: 12px;">
        <button id="btn-dock" style="background: #252526; color: #ccc; border: 1px solid #444; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 12px;">↙ Dock into IDE</button>
      </div>
      <canvas id="raylib-popup-canvas" width="${this.width}" height="${this.height}" style="background: #000; box-shadow: 0 4px 16px rgba(0,0,0,0.6); max-width: 96vw; max-height: 90vh; object-fit: contain;"></canvas>
    `;

    this.popupCanvas = this.popupWindow.document.getElementById('raylib-popup-canvas');
    this.popupCtx = this.popupCanvas.getContext('bitmaprenderer');

    const btnDock = this.popupWindow.document.getElementById('btn-dock');
    btnDock.addEventListener('click', () => {
      this.dockBack();
    });

    if (this.inputCoordinator && typeof this.inputCoordinator.attachListeners === 'function') {
      this.inputCoordinator.attachListeners(this.popupCanvas);
    }

    this.popupWindow.addEventListener('unload', () => {
      if (this.isPoppedOut) {
        this.isPoppedOut = false;
        this.popupWindow = null;
        this.popupCanvas = null;
        this.popupCtx = null;
        this.show();
      }
    });

    this.popupCanvas.focus();
  }

  dockBack() {
    if (this.popupWindow && !this.popupWindow.closed) {
      this.popupWindow.close();
    }
    this.popupWindow = null;
    this.popupCanvas = null;
    this.popupCtx = null;
    this.isPoppedOut = false;

    if (this.inputCoordinator && typeof this.inputCoordinator.attachListeners === 'function') {
      this.inputCoordinator.attachListeners(this.canvas);
    }

    this.show();
    this.canvas.focus();
  }

  renderBitmap(bitmap) {
    if (!bitmap) return;
    try {
      const activeCtx = (this.isPoppedOut && this.popupCtx) ? this.popupCtx : this.ctx;
      if (activeCtx) {
        if (typeof activeCtx.transferFromImageBitmap === 'function') {
          activeCtx.transferFromImageBitmap(bitmap);
          return;
        } else if (typeof activeCtx.drawImage === 'function') {
          activeCtx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return;
        }
      }
      bitmap.close();
    } catch (_) {
      try { bitmap.close(); } catch {}
    }
  }

  renderFrame(bitmap) {
    this.renderBitmap(bitmap);
  }

  updateFps(fps) {
    if (this.fpsBadge) {
      this.fpsBadge.textContent = `${Math.round(fps)} FPS`;
    }
  }

  updateFPS(fps) {
    this.updateFps(fps);
  }
}
