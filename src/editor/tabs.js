// Tab bar component rendering open file tabs and dirty markers

export class TabsUI {
  constructor(containerElement, editorManager) {
    this.container = containerElement;
    this.editorManager = editorManager;
  }

  render() {
    this.container.innerHTML = '';
    const openFiles = this.editorManager.getOpenFiles();
    const activePath = this.editorManager.getActivePath();

    for (const path of openFiles) {
      const isDirty = this.editorManager.isDirty(path);
      const isActive = path === activePath;
      const fileName = path.split('/').pop();

      const tab = document.createElement('div');
      tab.className = `tab-item ${isActive ? 'active' : ''}`;
      tab.title = path;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = fileName;
      tab.appendChild(titleSpan);

      if (isDirty) {
        const dirtyMarker = document.createElement('span');
        dirtyMarker.className = 'tab-dirty-marker';
        dirtyMarker.title = 'Unsaved changes';
        tab.appendChild(dirtyMarker);
      }

      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editorManager.closeFile(path);
        this.render();
      });
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => {
        if (!isActive) {
          this.editorManager.setActiveFile(path);
          this.render();
        }
      });

      this.container.appendChild(tab);
    }
  }
}
