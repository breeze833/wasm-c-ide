// Toolchain CLI Driver for gcc / clang / wasm-ld

export async function executeGccCommand({
  cmd,
  args,
  cwd,
  vfs,
  toolchain,
  mode,
  write,
}) {
  let compileOnly = false;
  let outputFile = null;
  const sources = [];
  const objects = [];
  const flags = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c') {
      compileOnly = true;
    } else if (arg === '-o') {
      if (i + 1 < args.length) {
        outputFile = args[++i];
      }
    } else if (arg.startsWith('-o') && arg.length > 2) {
      outputFile = arg.substring(2);
    } else if (arg.startsWith('-')) {
      flags.push(arg);
    } else if (arg.endsWith('.c') || arg.endsWith('.cpp') || arg.endsWith('.cc')) {
      sources.push(arg);
    } else if (arg.endsWith('.o') || arg.endsWith('.a')) {
      objects.push(arg);
    }
  }

  // Helper to resolve relative path to cwd
  const resolve = (p) => {
    if (!p) return '';
    if (p.startsWith('/')) return p;
    return `${cwd}/${p}`.replace(/\/+/g, '/');
  };

  // Ensure toolchain is initialized before accessing its MemFS
  if (toolchain && typeof toolchain.init === 'function') {
    await toolchain.init();
  }

  const ensureParentDir = (filePath) => {
    const norm = resolve(filePath);
    const lastSlash = norm.lastIndexOf('/');
    if (lastSlash > 0) {
      const dirPath = norm.substring(0, lastSlash);
      if (!vfs.exists(dirPath)) {
        try { vfs.mkdir(dirPath, true); } catch {}
      }
      if (typeof toolchain.ensureDirectoryInMemfs === 'function') {
        toolchain.ensureDirectoryInMemfs(dirPath);
      }
    }
  };

  // Sync VFS workspace files and directories into Toolchain MemFS
  const allWorkspaceFiles = vfs.getAllFiles('/workspace');
  const currentWorkspaceFiles = new Set();
  for (const f of allWorkspaceFiles) {
    if (f.isDir) {
      if (typeof toolchain.ensureDirectoryInMemfs === 'function') {
        toolchain.ensureDirectoryInMemfs(f.path);
      }
    } else {
      await toolchain.syncFileToMemfs(f.path, f.content);
      currentWorkspaceFiles.add(f.path.replace(/^\/+/, ''));
    }
  }

  // Purge any files deleted from VFS /workspace from MemFS
  if (toolchain.memfs && toolchain.memfs.files && typeof toolchain.removeFileFromMemfs === 'function') {
    for (const memfsPath of Array.from(toolchain.memfs.files)) {
      if (memfsPath.startsWith('workspace/') && !currentWorkspaceFiles.has(memfsPath)) {
        toolchain.removeFileFromMemfs(memfsPath);
      }
    }
  }

  // Sync or unsync Raylib sysroot files in toolchain MemFS according to VFS presence
  const raylibHeaders = [
    { vfs: '/usr/include/raylib.h', memfs: 'include/raylib.h' },
    { vfs: '/usr/include/raymath.h', memfs: 'include/raymath.h' },
    { vfs: '/usr/include/rlgl.h', memfs: 'include/rlgl.h' },
  ];

  const hasInMemfs = (path) => {
    if (typeof toolchain.hasFileInMemfs === 'function') {
      return toolchain.hasFileInMemfs(path);
    }
    if (toolchain.memfs && toolchain.memfs.files) {
      return toolchain.memfs.files.has(path.replace(/^\/+/, ''));
    }
    return false;
  };

  for (const h of raylibHeaders) {
    if (vfs.exists(h.vfs)) {
      if (!hasInMemfs(h.memfs)) {
        await toolchain.syncFileToMemfs(h.memfs, vfs.readFile(h.vfs, true));
      }
    } else {
      if (typeof toolchain.removeFileFromMemfs === 'function' && hasInMemfs(h.memfs)) {
        toolchain.removeFileFromMemfs(h.memfs);
      }
    }
  }

  if (vfs.exists('/usr/lib/libraylib.a')) {
    if (!hasInMemfs('usr/lib/libraylib.a')) {
      const libraylib = vfs.readFile('/usr/lib/libraylib.a', false);
      await toolchain.syncFileToMemfs('usr/lib/libraylib.a', libraylib);
      await toolchain.syncFileToMemfs('lib/wasm32-wasi/libraylib.a', libraylib);
    }
  } else {
    if (typeof toolchain.removeFileFromMemfs === 'function') {
      if (hasInMemfs('usr/lib/libraylib.a')) {
        toolchain.removeFileFromMemfs('usr/lib/libraylib.a');
      }
      if (hasInMemfs('lib/wasm32-wasi/libraylib.a')) {
        toolchain.removeFileFromMemfs('lib/wasm32-wasi/libraylib.a');
      }
    }
  }

  // Validate that all input source files exist in VFS
  for (const src of sources) {
    const srcResolved = resolve(src);
    if (!vfs.exists(srcResolved)) {
      write(`${cmd || 'gcc'}: error: ${src}: No such file or directory\r\n`);
      return 1;
    }
  }

  // Validate that all input object/library files exist in VFS
  for (const obj of objects) {
    const objResolved = resolve(obj);
    if (!vfs.exists(objResolved)) {
      write(`${cmd || 'gcc'}: error: ${obj}: No such file or directory\r\n`);
      return 1;
    }
  }

  const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : (mode || 'c');

  // Compile-only mode: gcc -c src/calc.c -o build/calc.o
  if (compileOnly) {
    if (sources.length === 0) {
      write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
      return 1;
    }

    for (const src of sources) {
      const srcResolved = resolve(src);
      const objResolved = outputFile
        ? resolve(outputFile)
        : srcResolved.replace(/\.(c|cpp|cc)$/, '.o');

      ensureParentDir(objResolved);

      const exitCode = await toolchain.compile(
        srcResolved,
        objResolved,
        effectiveMode,
        flags
      );

      if (exitCode === 0) {
        const objData = toolchain.getFileFromMemfs(objResolved);
        if (objData) {
          vfs.writeFile(objResolved, objData);
        }
      } else {
        return exitCode;
      }
    }

    return 0;
  }

  // Multi-step: compile sources to objects, then link
  const generatedObjects = [...objects.map(resolve)];

  for (const src of sources) {
    const srcResolved = resolve(src);
    const objResolved = srcResolved.replace(/\.(c|cpp|cc)$/, '.o');
    ensureParentDir(objResolved);

    const exitCode = await toolchain.compile(
      srcResolved,
      objResolved,
      effectiveMode,
      flags
    );

    if (exitCode !== 0) {
      return exitCode;
    }

    const objData = toolchain.getFileFromMemfs(objResolved);
    if (objData) {
      vfs.writeFile(objResolved, objData);
      generatedObjects.push(objResolved);
    }
  }

  // Link step
  if (generatedObjects.length === 0) {
    write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
    return 1;
  }

  const finalOutput = resolve(outputFile || 'a.out');
  ensureParentDir(finalOutput);
  const linkExitCode = await toolchain.link(generatedObjects, finalOutput, flags);

  if (linkExitCode === 0) {
    const binData = toolchain.getFileFromMemfs(finalOutput);
    if (binData) {
      vfs.writeFile(finalOutput, binData);
    }
  }

  return linkExitCode;
}
