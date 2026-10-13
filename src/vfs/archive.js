// JSZip Import & Export routines for /workspace

import JSZip from 'jszip';
import { saveWorkspace } from './storage.js';

export async function exportWorkspaceZip(vfs, filename = 'workspace.zip') {
  const zip = new JSZip();
  const files = vfs.getAllFiles('/workspace');

  for (const file of files) {
    // Strip leading /workspace/
    const relPath = file.path.replace(/^\/workspace\/?/, '');
    if (!relPath) continue;

    if (file.isDir) {
      zip.folder(relPath);
    } else {
      zip.file(relPath, file.content);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importWorkspaceZip(vfs, fileBlob, clearExisting = false) {
  const zip = await JSZip.loadAsync(fileBlob);

  if (clearExisting) {
    const existing = vfs.readDir('/workspace');
    for (const item of existing) {
      vfs.remove(`/workspace/${item.name}`, true);
    }
  }

  const entries = Object.keys(zip.files);
  for (const entryName of entries) {
    const entry = zip.files[entryName];
    // Path sanitization: remove leading slash, discard dangerous navigation
    const cleanRelPath = entryName.replace(/^(\/|\\)+/, '').replace(/\\/g, '/');
    if (cleanRelPath.includes('..') || cleanRelPath.startsWith('/')) {
      console.warn(`Skipping potentially unsafe zip entry: ${entryName}`);
      continue;
    }

    const fullPath = `/workspace/${cleanRelPath}`.replace(/\/+$/, '');

    if (entry.dir) {
      vfs.mkdir(fullPath, true);
    } else {
      const parts = fullPath.split('/');
      parts.pop();
      const parentDir = parts.join('/');
      vfs.mkdir(parentDir, true);

      const content = await entry.async('uint8array');
      vfs.writeFile(fullPath, content);
    }
  }

  await saveWorkspace(vfs);
}
