// Workspace File Tree Component

import { exportWorkspaceZip, importWorkspaceZip } from '../vfs/archive.js';

export class FileTreeUI {
  constructor(containerElement, vfs, onSelectFile = () => {}) {
    this.container = containerElement;
    this.vfs = vfs;
    this.onSelectFile = onSelectFile;
    this.expandedDirs = new Set(['/workspace', '/workspace/src', '/workspace/include']);

    this.vfs.subscribe(() => {
      this.render();
    });
  }

  render() {
    this.container.innerHTML = '';
    const rootList = document.createElement('div');
    rootList.className = 'tree-root';

    this._renderDirectory('/workspace', rootList);
    this.container.appendChild(rootList);
  }

  _renderDirectory(dirPath, parentElement) {
    let items = [];
    try {
      items = this.vfs.readDir(dirPath);
    } catch {
      return;
    }

    for (const item of items) {
      const itemPath = `${dirPath}/${item.name}`;
      const itemRow = document.createElement('div');
      itemRow.className = `tree-item ${item.isDir ? 'tree-dir' : 'tree-file'}`;

      if (item.isDir) {
        const isExpanded = this.expandedDirs.has(itemPath);

        const rowHeader = document.createElement('div');
        rowHeader.className = 'tree-item-row';
        rowHeader.innerHTML = `
          <span class="tree-icon">${isExpanded ? '▾' : '▸'}</span>
          <span class="tree-label">${item.name}/</span>
          <span class="tree-item-actions">
            <button class="tree-action-btn delete-btn" title="Delete folder">&times;</button>
          </span>
        `;

        rowHeader.querySelector('.tree-icon').addEventListener('click', (e) => {
          e.stopPropagation();
          if (isExpanded) {
            this.expandedDirs.delete(itemPath);
          } else {
            this.expandedDirs.add(itemPath);
          }
          this.render();
        });

        rowHeader.querySelector('.tree-label').addEventListener('click', (e) => {
          e.stopPropagation();
          if (isExpanded) {
            this.expandedDirs.delete(itemPath);
          } else {
            this.expandedDirs.add(itemPath);
          }
          this.render();
        });

        rowHeader.querySelector('.delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete folder ${itemPath}?`)) {
            try {
              this.vfs.remove(itemPath, true);
            } catch (err) {
              alert(err.message);
            }
          }
        });

        itemRow.appendChild(rowHeader);

        if (isExpanded) {
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'tree-children';
          this._renderDirectory(itemPath, childrenContainer);
          itemRow.appendChild(childrenContainer);
        }
      } else {
        const rowHeader = document.createElement('div');
        rowHeader.className = 'tree-item-row';
        rowHeader.innerHTML = `
          <span class="tree-icon-file">📄</span>
          <span class="tree-label">${item.name}</span>
          <span class="tree-item-actions">
            <button class="tree-action-btn delete-btn" title="Delete file">&times;</button>
          </span>
        `;

        rowHeader.addEventListener('click', () => {
          this.onSelectFile(itemPath);
        });

        rowHeader.querySelector('.delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete file ${itemPath}?`)) {
            try {
              this.vfs.remove(itemPath);
            } catch (err) {
              alert(err.message);
            }
          }
        });

        itemRow.appendChild(rowHeader);
      }

      parentElement.appendChild(itemRow);
    }
  }

  attachToolbarButtons({ btnNewFile, btnNewFolder, btnExportZip, btnImportZip }) {
    if (btnNewFile) {
      btnNewFile.addEventListener('click', () => {
        const relPath = prompt('Enter new file path (e.g. src/utils.c or main.c):');
        if (!relPath) return;
        const fullPath = `/workspace/${relPath.replace(/^\/+/, '')}`;
        if (this.vfs.exists(fullPath)) {
          alert('File already exists!');
          return;
        }
        try {
          this.vfs.writeFile(fullPath, '');
          this.onSelectFile(fullPath);
        } catch (err) {
          alert(err.message);
        }
      });
    }

    if (btnNewFolder) {
      btnNewFolder.addEventListener('click', () => {
        const folderName = prompt('Enter new folder name (e.g. include or lib):');
        if (!folderName) return;
        const fullPath = `/workspace/${folderName.replace(/^\/+/, '')}`;
        try {
          this.vfs.mkdir(fullPath, true);
          this.expandedDirs.add(fullPath);
          this.render();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    if (btnExportZip) {
      btnExportZip.addEventListener('click', () => {
        exportWorkspaceZip(this.vfs).catch(err => alert(`Export failed: ${err.message}`));
      });
    }

    if (btnImportZip) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.zip';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (confirm('Import zip into /workspace? This will merge with existing files.')) {
          try {
            await importWorkspaceZip(this.vfs, file);
            this.render();
          } catch (err) {
            alert(`Import error: ${err.message}`);
          }
        }
        fileInput.value = '';
      });

      btnImportZip.addEventListener('click', () => {
        fileInput.click();
      });
    }
  }
}
