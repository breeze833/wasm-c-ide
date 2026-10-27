// Toolchain CLI Driver for gcc / clang / wasm-ld backed directly by VFS

export function parseCompilerArgs(args, cwd = '/workspace') {
  let stage = null; // 'preprocess' (-E), 'assembly' (-S), 'compile' (-c), or null (link)
  let outputFile = null;
  const sources = [];
  const objects = [];
  const compilerFlags = [];
  const linkerFlags = [];

  const resolve = (p) => {
    if (!p) return '';
    if (p.startsWith('/')) return p;
    return `${cwd}/${p}`.replace(/\/+/g, '/');
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-E') {
      stage = 'preprocess';
    } else if (arg === '-S') {
      stage = 'assembly';
    } else if (arg === '-c') {
      stage = 'compile';
    } else if (arg === '-o') {
      if (i + 1 < args.length) {
        outputFile = args[++i];
      }
    } else if (arg.startsWith('-o') && arg.length > 2) {
      outputFile = arg.substring(2);
    } else if (arg === '-v') {
      compilerFlags.push('-v');
      linkerFlags.push('-v');
    } else if (arg === '-I') {
      if (i + 1 < args.length) {
        const dir = args[++i];
        compilerFlags.push(`-I${resolve(dir)}`);
      }
    } else if (arg.startsWith('-I')) {
      const dir = arg.substring(2);
      compilerFlags.push(`-I${resolve(dir)}`);
    } else if (arg === '-L') {
      if (i + 1 < args.length) {
        const dir = args[++i];
        const cleanDir = resolve(dir).replace(/^\/+/, '');
        linkerFlags.push(`-L${cleanDir}`);
      }
    } else if (arg.startsWith('-L')) {
      const dir = arg.substring(2);
      const cleanDir = resolve(dir).replace(/^\/+/, '');
      linkerFlags.push(`-L${cleanDir}`);
    } else if (arg === '-l') {
      if (i + 1 < args.length) {
        linkerFlags.push(`-l${args[++i]}`);
      }
    } else if (arg.startsWith('-l')) {
      linkerFlags.push(arg);
    } else if (arg === '-D') {
      if (i + 1 < args.length) {
        compilerFlags.push('-D', args[++i]);
      }
    } else if (arg.startsWith('-D')) {
      compilerFlags.push(arg);
    } else if (arg === '-U') {
      if (i + 1 < args.length) {
        compilerFlags.push('-U', args[++i]);
      }
    } else if (arg.startsWith('-U')) {
      compilerFlags.push(arg);
    } else if (arg === '-shared' || arg === '--shared') {
      linkerFlags.push('-shared');
    } else if (arg.startsWith('-Wl,')) {
      linkerFlags.push(...arg.substring(4).split(','));
    } else if (arg.startsWith('-')) {
      compilerFlags.push(arg);
    } else if (
      arg.endsWith('.c') ||
      arg.endsWith('.cpp') ||
      arg.endsWith('.cc') ||
      arg.endsWith('.i') ||
      arg.endsWith('.ii') ||
      arg.endsWith('.s')
    ) {
      sources.push(arg);
    } else if (arg.endsWith('.o') || arg.endsWith('.a') || arg.endsWith('.so')) {
      objects.push(arg);
    }
  }

  return {
    stage,
    compileOnly: stage === 'compile',
    outputFile,
    sources,
    objects,
    compilerFlags,
    linkerFlags,
    flags: [...compilerFlags, ...linkerFlags],
  };
}

export async function executeGccCommand({
  cmd,
  args,
  cwd = '/workspace',
  vfs,
  toolchain,
  mode,
  write,
}) {
  const { stage, outputFile, sources, objects, compilerFlags, linkerFlags } = parseCompilerArgs(args, cwd);

  const resolve = (p) => {
    if (!p) return '';
    if (p.startsWith('/')) return p;
    return `${cwd}/${p}`.replace(/\/+/g, '/');
  };

  if (toolchain && typeof toolchain.init === 'function') {
    await toolchain.init();
  }

  const prevHostWrite = toolchain ? toolchain.hostWrite : null;
  if (toolchain) {
    toolchain.hostWrite = (str) => {
      if (typeof write === 'function') {
        write(str);
      } else if (typeof prevHostWrite === 'function') {
        prevHostWrite(str);
      }
    };
  }

  try {
    const ensureParentDir = (filePath) => {
      const norm = resolve(filePath);
      const lastSlash = norm.lastIndexOf('/');
      if (lastSlash > 0) {
        const dirPath = norm.substring(0, lastSlash);
        if (!vfs.exists(dirPath)) {
          try { vfs.mkdir(dirPath, true, true); } catch {}
        }
      }
    };

    // Backward-compatibility hook for mock toolchains that require syncFileToMemfs
    if (toolchain && typeof toolchain.syncFileToMemfs === 'function' && typeof vfs.listFilesRecursive === 'function') {
      const workspaceFiles = vfs.listFilesRecursive('/workspace');
      for (const f of workspaceFiles) {
        if (!f.isDir) {
          await toolchain.syncFileToMemfs(f.path, f.content);
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

    // Stage: Preprocess (-E)
    if (stage === 'preprocess') {
      if (sources.length === 0) {
        write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
        return 1;
      }

      for (const src of sources) {
        const srcResolved = resolve(src);
        if (outputFile && outputFile !== '-') {
          const outResolved = resolve(outputFile);
          ensureParentDir(outResolved);
          const exitCode = await toolchain.compile(
            srcResolved,
            outResolved,
            effectiveMode,
            compilerFlags,
            { stage: 'preprocess' }
          );
          if (exitCode !== 0) {
            return exitCode;
          }
        } else {
          const exitCode = await toolchain.compile(
            srcResolved,
            '-',
            effectiveMode,
            compilerFlags,
            { stage: 'preprocess' }
          );
          if (exitCode !== 0) {
            return exitCode;
          }
        }
      }
      return 0;
    }

    // Stage: Assembly (-S)
    if (stage === 'assembly') {
      if (sources.length === 0) {
        write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
        return 1;
      }

      for (const src of sources) {
        const srcResolved = resolve(src);
        if (outputFile === '-') {
          const exitCode = await toolchain.compile(
            srcResolved,
            '-',
            effectiveMode,
            compilerFlags,
            { stage: 'assembly' }
          );
          if (exitCode !== 0) {
            return exitCode;
          }
        } else {
          const outResolved = outputFile
            ? resolve(outputFile)
            : srcResolved.replace(/\.(c|cpp|cc)$/, '.s');
          ensureParentDir(outResolved);
          const exitCode = await toolchain.compile(
            srcResolved,
            outResolved,
            effectiveMode,
            compilerFlags,
            { stage: 'assembly' }
          );
          if (exitCode !== 0) {
            return exitCode;
          }
        }
      }
      return 0;
    }

    // Stage: Compile-only (-c)
    if (stage === 'compile') {
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
          compilerFlags,
          { stage: 'compile' }
        );

        if (exitCode !== 0) {
          return exitCode;
        }

        if (typeof toolchain.getFileFromMemfs === 'function') {
          const objData = toolchain.getFileFromMemfs(objResolved);
          if (objData && !vfs.exists(objResolved)) {
            vfs.writeFile(objResolved, objData);
          }
        }
      }

      return 0;
    }

    // Stage: Full Compile & Link (default when neither -E, -S, nor -c is given)
    const generatedObjects = [...objects.map(resolve)];

    for (const src of sources) {
      const srcResolved = resolve(src);
      const objResolved = srcResolved.replace(/\.(c|cpp|cc)$/, '.o');
      ensureParentDir(objResolved);

      const exitCode = await toolchain.compile(
        srcResolved,
        objResolved,
        effectiveMode,
        compilerFlags,
        { stage: 'compile' }
      );

      if (exitCode !== 0) {
        return exitCode;
      }

      if (typeof toolchain.getFileFromMemfs === 'function') {
        const objData = toolchain.getFileFromMemfs(objResolved);
        if (objData && !vfs.exists(objResolved)) {
          vfs.writeFile(objResolved, objData);
        }
      }

      if (vfs.exists(objResolved) || (toolchain.getFileFromMemfs && toolchain.getFileFromMemfs(objResolved))) {
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
    const linkExitCode = await toolchain.link(generatedObjects, finalOutput, linkerFlags);

    if (linkExitCode === 0 && typeof toolchain.getFileFromMemfs === 'function') {
      const binData = toolchain.getFileFromMemfs(finalOutput);
      if (binData && !vfs.exists(finalOutput)) {
        vfs.writeFile(finalOutput, binData);
      }
    }

    return linkExitCode;
  } finally {
    if (toolchain && prevHostWrite !== undefined) {
      toolchain.hostWrite = prevHostWrite;
    }
  }
}
