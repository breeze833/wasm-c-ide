// IndexedDB Persistence Layer for /workspace

const DB_NAME = 'wasm_c_ide_db';
const DB_VERSION = 1;
const STORE_NAME = 'workspace_files';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(vfs) {
  const db = await openDatabase();
  const files = vfs.getAllFiles('/workspace');

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Clear old records and write all current workspace files
    store.clear();

    for (const file of files) {
      store.put({
        path: file.path,
        isDir: file.isDir,
        content: file.isDir ? null : file.content,
        mtime: file.mtime,
      });
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWorkspace(vfs) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = async () => {
      const records = request.result || [];
      if (records.length === 0) {
        // Populate default pedagogical sample project
        initDefaultWorkspace(vfs);
        await saveWorkspace(vfs);
        resolve(false); // was freshly created
      } else {
        // Restore all folders first, then files
        const dirs = records.filter(r => r.isDir).sort((a, b) => a.path.length - b.path.length);
        const files = records.filter(r => !r.isDir);

        for (const dir of dirs) {
          vfs.mkdir(dir.path, true);
        }
        for (const file of files) {
          vfs.writeFile(file.path, file.content, file.mtime);
        }
        resolve(true); // restored from IndexedDB
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export function initDefaultWorkspace(vfs) {
  vfs.mkdir('/workspace/src', true);
  vfs.mkdir('/workspace/include', true);
  vfs.mkdir('/workspace/build', true);

  vfs.writeFile('/workspace/src/main.c', `#include <stdio.h>
#include "calc.h"

int main(void) {
    int a = 10, b = 20;
    printf("Hello, In-Browser Wasm C IDE!\\n");
    printf("%d + %d = %d\\n", a, b, add(a, b));
    return 0;
}
`);

  vfs.writeFile('/workspace/src/calc.c', `#include "calc.h"

int add(int a, int b) {
    return a + b;
}
`);

  vfs.writeFile('/workspace/include/calc.h', `#ifndef CALC_H
#define CALC_H

int add(int a, int b);

#endif
`);

  vfs.writeFile('/workspace/build.sh', `#!/bin/sh
mkdir -p build
gcc -Iinclude -Wall -c src/calc.c -o build/calc.o
gcc -Iinclude -Wall -c src/main.c -o build/main.o
gcc build/calc.o build/main.o -o a.out
echo "Build complete: a.out"
`);

  vfs.writeFile('/workspace/Makefile', `CC = gcc
CFLAGS = -Iinclude -Wall

all: a.out

build:
\tmkdir -p build

build/calc.o: src/calc.c | build
\t$(CC) $(CFLAGS) -c src/calc.c -o build/calc.o

build/main.o: src/main.c | build
\t$(CC) $(CFLAGS) -c src/main.c -o build/main.o

a.out: build/calc.o build/main.o
\t$(CC) build/calc.o build/main.o -o a.out

clean:
\trm -rf build a.out
`);
}

let syncTimeout = null;
export function setupAutoSync(vfs, debounceMs = 600) {
  vfs.subscribe((event) => {
    if (event.path && event.path.startsWith('/workspace')) {
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        saveWorkspace(vfs).catch(err => console.error('IndexedDB sync error:', err));
      }, debounceMs);
    }
  });
}
