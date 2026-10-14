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
  for (const f of allWorkspaceFiles) {
    if (f.isDir) {
      if (typeof toolchain.ensureDirectoryInMemfs === 'function') {
        toolchain.ensureDirectoryInMemfs(f.path);
      }
    } else {
      await toolchain.syncFileToMemfs(f.path, f.content);
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
