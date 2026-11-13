// Toolchain CLI Driver for gcc / clang / wasm-ld backed directly by VFS
// Re-exports upstream generic drivers from clang-wasi with synchronous execution support for Make

import {
  parseCompilerArgs,
  executeGccCommand,
  executeLdCommand,
  executeToolCommand,
} from 'clang-wasi/driver';

export {
  parseCompilerArgs,
  executeGccCommand,
  executeLdCommand,
  executeToolCommand,
};

/**
 * Synchronous GCC/Clang command runner for synchronous make recipe execution.
 */
export function executeGccCommandSync({
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
    if (sources.length === 0 && objects.length === 0) {
      if (toolchain && typeof toolchain.runClangSync === 'function') {
        return toolchain.runClangSync(cmd, args, { cwd });
      }
      if (typeof write === 'function') write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
      return 1;
    }

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

    for (const src of sources) {
      const srcResolved = resolve(src);
      if (!vfs.exists(srcResolved)) {
        if (typeof write === 'function') write(`${cmd || 'gcc'}: error: ${src}: No such file or directory\r\n`);
        return 1;
      }
    }

    for (const obj of objects) {
      const objResolved = resolve(obj);
      if (!vfs.exists(objResolved)) {
        if (typeof write === 'function') write(`${cmd || 'gcc'}: error: ${obj}: No such file or directory\r\n`);
        return 1;
      }
    }

    const effectiveMode = (cmd === 'g++' || cmd === 'clang++') ? 'cpp' : (mode || 'c');

    if (stage === 'preprocess') {
      if (sources.length === 0) {
        if (typeof write === 'function') write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
        return 1;
      }

      for (const src of sources) {
        const srcResolved = resolve(src);
        if (outputFile && outputFile !== '-') {
          const outResolved = resolve(outputFile);
          ensureParentDir(outResolved);
          const exitCode = toolchain.compileSync(
            srcResolved,
            outResolved,
            effectiveMode,
            compilerFlags,
            { stage: 'preprocess', cwd }
          );
          if (exitCode !== 0) return exitCode;
        } else {
          const exitCode = toolchain.compileSync(
            srcResolved,
            '-',
            effectiveMode,
            compilerFlags,
            { stage: 'preprocess', cwd }
          );
          if (exitCode !== 0) return exitCode;
        }
      }
      return 0;
    }

    if (stage === 'assembly') {
      if (sources.length === 0) {
        if (typeof write === 'function') write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
        return 1;
      }

      for (const src of sources) {
        const srcResolved = resolve(src);
        if (outputFile === '-') {
          const exitCode = toolchain.compileSync(
            srcResolved,
            '-',
            effectiveMode,
            compilerFlags,
            { stage: 'assembly', cwd }
          );
          if (exitCode !== 0) return exitCode;
        } else {
          const outResolved = outputFile
            ? resolve(outputFile)
            : srcResolved.replace(/\.(c|cpp|cc|cxx)$/, '.s');
          ensureParentDir(outResolved);
          const exitCode = toolchain.compileSync(
            srcResolved,
            outResolved,
            effectiveMode,
            compilerFlags,
            { stage: 'assembly', cwd }
          );
          if (exitCode !== 0) return exitCode;
        }
      }
      return 0;
    }

    if (stage === 'compile') {
      if (sources.length === 0) {
        if (typeof write === 'function') write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
        return 1;
      }

      for (const src of sources) {
        const srcResolved = resolve(src);
        const objResolved = outputFile
          ? resolve(outputFile)
          : srcResolved.replace(/\.(c|cpp|cc|cxx)$/, '.o');

        ensureParentDir(objResolved);

        const exitCode = toolchain.compileSync(
          srcResolved,
          objResolved,
          effectiveMode,
          compilerFlags,
          { stage: 'compile', cwd }
        );

        if (exitCode !== 0) return exitCode;

        if (typeof toolchain.getFile === 'function') {
          const objData = toolchain.getFile(objResolved);
          if (objData && !vfs.exists(objResolved)) {
            vfs.writeFile(objResolved, objData);
          }
        }
      }

      return 0;
    }

    const generatedObjects = [...objects.map(resolve)];

    for (const src of sources) {
      const srcResolved = resolve(src);
      const objResolved = srcResolved.replace(/\.(c|cpp|cc|cxx)$/, '.o');
      ensureParentDir(objResolved);

      const exitCode = toolchain.compileSync(
        srcResolved,
        objResolved,
        effectiveMode,
        compilerFlags,
        { stage: 'compile', cwd }
      );

      if (exitCode !== 0) return exitCode;

      if (typeof toolchain.getFile === 'function') {
        const objData = toolchain.getFile(objResolved);
        if (objData && !vfs.exists(objResolved)) {
          vfs.writeFile(objResolved, objData);
        }
      }

      if (vfs.exists(objResolved) || (toolchain.getFile && toolchain.getFile(objResolved))) {
        generatedObjects.push(objResolved);
      }
    }

    if (generatedObjects.length === 0) {
      if (typeof write === 'function') write(`${cmd || 'gcc'}: fatal error: no input files\r\n`);
      return 1;
    }

    const finalOutput = resolve(outputFile || 'a.out');
    ensureParentDir(finalOutput);
    const linkExitCode = toolchain.linkSync(generatedObjects, finalOutput, linkerFlags);

    if (linkExitCode === 0 && typeof toolchain.getFile === 'function') {
      const binData = toolchain.getFile(finalOutput);
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
