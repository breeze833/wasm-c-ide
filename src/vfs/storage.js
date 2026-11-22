// IndexedDB Persistence Layer for /workspace
// Delegates storage mechanics to web-ide-core/workspace while providing the C/C++ starter project seed

import { createWorkspaceStorage } from 'web-ide-core/workspace';

export const DEFAULT_WORKSPACE_FILES = {
  'src': null,
  'include': null,
  'build': null,
  'src/main.c': `#include <stdio.h>
#include "calc.h"

int main(void) {
    int a = 10, b = 20;
    printf("Hello, In-Browser Wasm C IDE!\\n");
    printf("%d + %d = %d\\n", a, b, add(a, b));
    return 0;
}
`,
  'src/calc.c': `#include "calc.h"

int add(int a, int b) {
    return a + b;
}
`,
  'include/calc.h': `#ifndef CALC_H
#define CALC_H

int add(int a, int b);

#endif
`,
  'build.sh': `#!/bin/sh
mkdir -p build
gcc -Iinclude -Wall -c src/calc.c -o build/calc.o
gcc -Iinclude -Wall -c src/main.c -o build/main.o
gcc build/calc.o build/main.o -o a.out
echo "Build complete: a.out"
`,
  'Makefile': `CC = gcc
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
`,
};

const storage = createWorkspaceStorage({
  dbName: 'wasm_c_ide_db',
  storeName: 'workspace_files',
  rootPath: '/workspace',
  debounceMs: 600,
});

export function openDatabase() {
  return storage.openDatabase();
}

export function saveWorkspace(vfs) {
  return storage.saveWorkspace(vfs);
}

export function initDefaultWorkspace(vfs) {
  return storage.seedDefaultWorkspace(vfs, DEFAULT_WORKSPACE_FILES);
}

export function loadWorkspace(vfs) {
  return storage.loadWorkspace(vfs, { defaultFiles: DEFAULT_WORKSPACE_FILES });
}

export function setupAutoSync(vfs, debounceMs = 600) {
  return storage.setupAutoSync(vfs, debounceMs);
}
