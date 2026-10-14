// Web Worker: Interactive Hybrid POSIX Shell
// Handles command editing, history, tab completion, built-in utilities, and command interception

let cwd = '/workspace';
let lineBuffer = '';
let cursorPos = 0;
const history = [];
let historyIndex = -1;
let isExecuting = false;

// RPC bridge to main thread VFS & Toolchain
let rpcCounter = 0;
const pendingRpcs = new Map();

function callHost(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++rpcCounter;
    pendingRpcs.set(id, { resolve, reject });
    self.postMessage({ type, id, payload });
  });
}

// Shell output & input stream helpers
let currentStdout = null;
let currentStdin = null;

function write(str) {
  if (currentStdout !== null) {
    currentStdout.data += str;
  } else {
    self.postMessage({ type: 'term_write', data: str });
  }
}

function writeln(str = '') {
  if (currentStdout !== null) {
    currentStdout.data += str + '\n';
  } else {
    self.postMessage({ type: 'term_write', data: str + '\r\n' });
  }
}

function getPrompt() {
  const displayCwd = cwd === '/workspace' ? '~' : cwd.replace(/^\/workspace/, '~');
  return `\x1b[1;32mide\x1b[0m:\x1b[1;34m${displayCwd}\x1b[0m$ `;
}

function showPrompt() {
  lineBuffer = '';
  cursorPos = 0;
  historyIndex = -1;
  write(getPrompt());
}

// Path resolver relative to cwd
function resolvePath(p) {
  if (!p) return cwd;
  let target = p.startsWith('/') ? p : `${cwd}/${p}`;
  const parts = target.split('/').filter(Boolean);
  const resolved = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return '/' + resolved.join('/');
}

// Command line tokenizer distinguishing quoted vs unquoted tokens
function parseTokens(line) {
  const tokens = [];
  let current = '';
  let inQuotes = null;
  let isQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === inQuotes) {
        inQuotes = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuotes = ch;
      isQuoted = true;
    } else if (ch === '>' && line[i + 1] === '>') {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
      tokens.push({ text: '>>', quoted: false });
      i++;
    } else if (ch === '>' || ch === '<') {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
      tokens.push({ text: ch, quoted: false });
    } else if (/\s/.test(ch)) {
      if (current.length > 0 || isQuoted) {
        tokens.push({ text: current, quoted: isQuoted });
        current = '';
        isQuoted = false;
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || isQuoted) {
    tokens.push({ text: current, quoted: isQuoted });
  }

  return tokens;
}

function parseArgs(line) {
  return parseTokens(line).map(t => t.text);
}

// Glob expansion helpers
function hasGlob(token) {
  return /[*?]/.test(token);
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

async function expandGlobToken(token, currentDir) {
  if (!hasGlob(token)) return [token];

  const isAbsolute = token.startsWith('/');
  const rawParts = token.split('/').filter(Boolean);

  async function expandSegments(currentVfsPath, segmentIndex, currentPrefix) {
    if (segmentIndex >= rawParts.length) {
      return [currentPrefix];
    }

    const segment = rawParts[segmentIndex];
    const isLast = segmentIndex === rawParts.length - 1;

    if (!hasGlob(segment)) {
      const nextVfsPath = currentVfsPath === '/' ? `/${segment}` : `${currentVfsPath}/${segment}`;
      const nextPrefix = currentPrefix
        ? (currentPrefix === '/' ? `/${segment}` : `${currentPrefix}/${segment}`)
        : segment;
      try {
        const exists = await callHost('vfs_exists', { path: nextVfsPath });
        if (!exists) return [];
        return await expandSegments(nextVfsPath, segmentIndex + 1, nextPrefix);
      } catch {
        return [];
      }
    }

    try {
      const entries = await callHost('vfs_readDir', { path: currentVfsPath });
      const regex = globToRegex(segment);
      const matches = entries.filter(e => {
        if (!segment.startsWith('.') && e.name.startsWith('.')) return false;
        return regex.test(e.name);
      });

      const results = [];
      for (const match of matches) {
        if (!isLast && !match.isDir) continue;
        const nextVfsPath = currentVfsPath === '/' ? `/${match.name}` : `${currentVfsPath}/${match.name}`;
        const nextPrefix = currentPrefix
          ? (currentPrefix === '/' ? `/${match.name}` : `${currentPrefix}/${match.name}`)
          : match.name;
        const sub = await expandSegments(nextVfsPath, segmentIndex + 1, nextPrefix);
        results.push(...sub);
      }
      return results;
    } catch {
      return [];
    }
  }

  const startVfsPath = isAbsolute ? '/' : currentDir;
  const startPrefix = isAbsolute ? (token.startsWith('//') ? '//' : '/') : '';
  const expanded = await expandSegments(startVfsPath, 0, startPrefix);

  if (expanded.length === 0) {
    return [token];
  }

  return expanded.sort();
}

const dirStack = [];
let oldPwd = '/workspace';

function formatStackPath(p) {
  return p === '/workspace' ? '~' : p.replace(/^\/workspace/, '~');
}

function printDirStack() {
  const all = [cwd, ...dirStack.slice().reverse()].map(formatStackPath);
  writeln(all.join(' '));
}

// Built-in POSIX CLI Commands
const builtins = {
  pwd: async () => {
    writeln(cwd);
    return 0;
  },

  cd: async (args) => {
    let target = args[0];
    if (!target) {
      target = '/workspace';
    } else if (target === '-') {
      target = oldPwd;
      writeln(target);
    } else {
      target = resolvePath(target);
    }

    try {
      const exists = await callHost('vfs_exists', { path: target });
      if (!exists) {
        writeln(`cd: no such file or directory: ${args[0]}`);
        return 1;
      }
      const stat = await callHost('vfs_stat', { path: target });
      if (!stat || !stat.isDir) {
        writeln(`cd: not a directory: ${args[0]}`);
        return 1;
      }
      oldPwd = cwd;
      cwd = target;
      return 0;
    } catch (err) {
      writeln(`cd: ${err.message}`);
      return 1;
    }
  },

  pushd: async (args) => {
    let target = args[0];
    if (!target) {
      if (dirStack.length === 0) {
        writeln('pushd: no other directory');
        return 1;
      }
      const top = dirStack.pop();
      dirStack.push(cwd);
      oldPwd = cwd;
      cwd = top;
      printDirStack();
      return 0;
    }

    if (target === '.') {
      dirStack.push(cwd);
      printDirStack();
      return 0;
    }

    const resolved = resolvePath(target);
    try {
      const exists = await callHost('vfs_exists', { path: resolved });
      if (!exists) {
        writeln(`pushd: ${target}: No such file or directory`);
        return 1;
      }
      const stat = await callHost('vfs_stat', { path: resolved });
      if (!stat || !stat.isDir) {
        writeln(`pushd: ${target}: Not a directory`);
        return 1;
      }
      dirStack.push(cwd);
      oldPwd = cwd;
      cwd = resolved;
      printDirStack();
      return 0;
    } catch (err) {
      writeln(`pushd: ${err.message}`);
      return 1;
    }
  },

  popd: async () => {
    if (dirStack.length === 0) {
      writeln('popd: directory stack empty');
      return 1;
    }
    const popped = dirStack.pop();
    oldPwd = cwd;
    cwd = popped;
    printDirStack();
    return 0;
  },

  dirs: async () => {
    printDirStack();
    return 0;
  },

  ls: async (args) => {
    let showAll = false;
    let longFormat = false;
    const paths = [];

    for (const arg of args) {
      if (arg.startsWith('-')) {
        if (arg.includes('a')) showAll = true;
        if (arg.includes('l')) longFormat = true;
      } else {
        paths.push(arg);
      }
    }

    const formatItem = (name, isDir, size) => {
      if (longFormat) {
        const typeChar = isDir ? 'd' : '-';
        const sizeStr = String(size).padStart(8, ' ');
        const nameColored = isDir
          ? `\x1b[1;34m${name}\x1b[0m`
          : (name.endsWith('.out') || name.endsWith('.wasm'))
          ? `\x1b[1;32m${name}\x1b[0m`
          : name;
        return `${typeChar}rwxr-xr-x 1 user staff ${sizeStr} ${nameColored}`;
      } else {
        if (isDir) return `\x1b[1;34m${name}/\x1b[0m`;
        if (name.endsWith('.out') || name.endsWith('.wasm')) return `\x1b[1;32m${name}\x1b[0m`;
        return name;
      }
    };

    if (paths.length === 0) {
      try {
        const items = await callHost('vfs_readDir', { path: cwd });
        const filtered = showAll ? items : items.filter(it => !it.name.startsWith('.'));
        if (longFormat) {
          for (const item of filtered) {
            writeln(formatItem(item.name, item.isDir, item.size));
          }
        } else {
          writeln(filtered.map(item => formatItem(item.name, item.isDir, item.size)).join('  '));
        }
      } catch (err) {
        writeln(`ls: cannot access '${cwd}': ${err.message}`);
      }
      return;
    }

    // Inspect each path in paths
    const missing = [];
    const fileList = [];
    const dirList = [];

    for (const p of paths) {
      const target = resolvePath(p);
      try {
        const exists = await callHost('vfs_exists', { path: target });
        if (!exists) {
          missing.push({ path: p, target });
        } else {
          const stat = await callHost('vfs_stat', { path: target });
          if (stat.isDir) {
            dirList.push({ path: p, target, stat });
          } else {
            fileList.push({ path: p, target, stat });
          }
        }
      } catch {
        missing.push({ path: p, target });
      }
    }

    for (const m of missing) {
      writeln(`ls: cannot access '${m.path}': No such file or directory`);
    }

    if (fileList.length > 0) {
      if (longFormat) {
        for (const f of fileList) {
          writeln(formatItem(f.path, false, f.stat.size));
        }
      } else {
        writeln(fileList.map(f => formatItem(f.path, false, f.stat.size)).join('  '));
      }
    }

    for (let i = 0; i < dirList.length; i++) {
      const d = dirList[i];
      if (paths.length > 1) {
        if (fileList.length > 0 || i > 0) writeln('');
        writeln(`${d.path}:`);
      }
      try {
        const items = await callHost('vfs_readDir', { path: d.target });
        const filtered = showAll ? items : items.filter(it => !it.name.startsWith('.'));
        if (longFormat) {
          for (const item of filtered) {
            writeln(formatItem(item.name, item.isDir, item.size));
          }
        } else {
          writeln(filtered.map(item => formatItem(item.name, item.isDir, item.size)).join('  '));
        }
      } catch (err) {
        writeln(`ls: cannot access '${d.path}': ${err.message}`);
      }
    }
  },

  cat: async (args) => {
    if (args.length === 0) {
      if (currentStdin !== null) {
        write(currentStdin);
      } else {
        await readInteractiveStdin((line) => {
          write(line);
        });
      }
      return 0;
    }
    let hasError = false;
    for (const arg of args) {
      if (arg === '-') {
        if (currentStdin !== null) {
          write(currentStdin);
        } else {
          await readInteractiveStdin((line) => {
            write(line);
          });
        }
        continue;
      }
      const target = resolvePath(arg);
      try {
        const content = await callHost('vfs_readFile', { path: target, asText: true });
        write(content.endsWith('\n') ? content : content + '\n');
      } catch (err) {
        writeln(`cat: ${arg}: No such file or directory`);
        hasError = true;
      }
    }
    return hasError ? 1 : 0;
  },

  echo: async (args) => {
    writeln(args.join(' '));
    return 0;
  },

  mkdir: async (args) => {
    let recursive = false;
    const dirs = [];
    for (const arg of args) {
      if (arg === '-p') recursive = true;
      else if (!arg.startsWith('-')) dirs.push(arg);
    }
    if (dirs.length === 0) {
      writeln('mkdir: missing operand');
      return 1;
    }
    let hasError = false;
    for (const dir of dirs) {
      const target = resolvePath(dir);
      try {
        await callHost('vfs_mkdir', { path: target, recursive });
      } catch (err) {
        writeln(`mkdir: cannot create directory '${dir}': ${err.message}`);
        hasError = true;
      }
    }
    return hasError ? 1 : 0;
  },

  rm: async (args) => {
    let recursive = false;
    let force = false;
    const targets = [];
    for (const arg of args) {
      if (arg === '-r' || arg === '-R') recursive = true;
      else if (arg === '-f') force = true;
      else if (arg === '-rf' || arg === '-fr') { recursive = true; force = true; }
      else if (!arg.startsWith('-')) targets.push(arg);
    }
    if (targets.length === 0) {
      if (!force) {
        writeln('rm: missing operand');
        return 1;
      }
      return 0;
    }
    let hasError = false;
    for (const target of targets) {
      const resolved = resolvePath(target);
      try {
        await callHost('vfs_remove', { path: resolved, recursive });
      } catch (err) {
        if (!force) {
          writeln(`rm: cannot remove '${target}': ${err.message}`);
          hasError = true;
        }
      }
    }
    return hasError ? 1 : 0;
  },

  cp: async (args) => {
    let recursive = false;
    const operands = [];
    for (const arg of args) {
      if (arg === '-r' || arg === '-R' || arg === '-rf' || arg === '-fr') {
        recursive = true;
      } else if (arg.startsWith('-')) {
        // ignore other flags
      } else {
        operands.push(arg);
      }
    }

    if (operands.length === 0) {
      writeln('cp: missing file operand');
      return 1;
    }
    if (operands.length === 1) {
      writeln(`cp: missing destination file operand after '${operands[0]}'`);
      return 1;
    }

    const destRaw = operands[operands.length - 1];
    const sourcesRaw = operands.slice(0, operands.length - 1);
    const destNorm = resolvePath(destRaw);
    const destStat = await callHost('vfs_stat', { path: destNorm });
    const destIsDir = destStat && destStat.isDir;
    const destEndsWithSlash = destRaw.endsWith('/');

    if (sourcesRaw.length > 1 && !destIsDir) {
      writeln(`cp: target '${destRaw}' is not a directory`);
      return 1;
    }

    if (destEndsWithSlash && !destIsDir && !destStat) {
      writeln(`cp: cannot create regular file '${destRaw}': Not a directory`);
      return 1;
    }

    let hasError = false;

    async function copyEntry(srcPath, dstPath) {
      const stat = await callHost('vfs_stat', { path: srcPath });
      if (!stat) {
        throw new Error(`No such file or directory: ${srcPath}`);
      }
      if (stat.isDir) {
        if (!recursive) {
          throw new Error(`-r not specified; omitting directory '${srcPath}'`);
        }
        await callHost('vfs_mkdir', { path: dstPath, recursive: true });
        const entries = await callHost('vfs_readDir', { path: srcPath });
        for (const entry of entries) {
          const childSrc = srcPath === '/' ? `/${entry.name}` : `${srcPath}/${entry.name}`;
          const childDst = dstPath === '/' ? `/${entry.name}` : `${dstPath}/${entry.name}`;
          await copyEntry(childSrc, childDst);
        }
      } else {
        const content = await callHost('vfs_readFile', { path: srcPath, asText: false });
        await callHost('vfs_writeFile', { path: dstPath, content });
      }
    }

    for (const srcRaw of sourcesRaw) {
      const srcNorm = resolvePath(srcRaw);
      const srcStat = await callHost('vfs_stat', { path: srcNorm });
      if (!srcStat) {
        writeln(`cp: cannot stat '${srcRaw}': No such file or directory`);
        hasError = true;
        continue;
      }

      const srcBase = srcNorm.split('/').filter(Boolean).pop();
      let targetPath;
      if (destIsDir) {
        targetPath = destNorm === '/' ? `/${srcBase}` : `${destNorm}/${srcBase}`;
      } else {
        targetPath = destNorm;
      }

      if (srcNorm === targetPath) {
        writeln(`cp: '${srcRaw}' and '${destRaw}' are the same file`);
        hasError = true;
        continue;
      }

      try {
        await copyEntry(srcNorm, targetPath);
      } catch (err) {
        writeln(`cp: cannot copy '${srcRaw}' to '${destRaw}': ${err.message}`);
        hasError = true;
      }
    }

    return hasError ? 1 : 0;
  },

  mv: async (args) => {
    const operands = [];
    for (const arg of args) {
      if (arg.startsWith('-') && arg.length > 1) {
        // ignore flags like -f, -v
      } else {
        operands.push(arg);
      }
    }

    if (operands.length === 0) {
      writeln('mv: missing file operand');
      return 1;
    }
    if (operands.length === 1) {
      writeln(`mv: missing destination file operand after '${operands[0]}'`);
      return 1;
    }

    const destRaw = operands[operands.length - 1];
    const sourcesRaw = operands.slice(0, operands.length - 1);
    const destNorm = resolvePath(destRaw);
    const destStat = await callHost('vfs_stat', { path: destNorm });
    const destIsDir = destStat && destStat.isDir;
    const destEndsWithSlash = destRaw.endsWith('/');

    if (sourcesRaw.length > 1 && !destIsDir) {
      writeln(`mv: target '${destRaw}' is not a directory`);
      return 1;
    }

    if (destEndsWithSlash && !destIsDir && !destStat) {
      writeln(`mv: cannot move to '${destRaw}': Not a directory`);
      return 1;
    }

    let hasError = false;

    for (const srcRaw of sourcesRaw) {
      const srcNorm = resolvePath(srcRaw);
      const srcStat = await callHost('vfs_stat', { path: srcNorm });
      if (!srcStat) {
        writeln(`mv: cannot stat '${srcRaw}': No such file or directory`);
        hasError = true;
        continue;
      }

      if (srcNorm === '/' || srcNorm === '/workspace') {
        writeln(`mv: cannot move root or workspace: '${srcRaw}'`);
        hasError = true;
        continue;
      }

      const srcBase = srcNorm.split('/').filter(Boolean).pop();
      let targetPath;
      if (destIsDir) {
        targetPath = destNorm === '/' ? `/${srcBase}` : `${destNorm}/${srcBase}`;
      } else {
        targetPath = destNorm;
      }

      if (srcNorm === targetPath) {
        writeln(`mv: '${srcRaw}' and '${destRaw}' are the same file`);
        hasError = true;
        continue;
      }

      if (srcStat.isDir && (targetPath + '/').startsWith(srcNorm + '/')) {
        writeln(`mv: cannot move '${srcRaw}' to a subdirectory of itself, '${destRaw}'`);
        hasError = true;
        continue;
      }

      try {
        await callHost('vfs_rename', { oldPath: srcNorm, newPath: targetPath });
      } catch (err) {
        writeln(`mv: cannot move '${srcRaw}' to '${destRaw}': ${err.message}`);
        hasError = true;
      }
    }

    return hasError ? 1 : 0;
  },

  clear: async () => {
    write('\x1b[2J\x1b[H');
  },

    sh: async (args) => {
    if (args.length === 0) {
      writeln('sh: script file required');
      return;
    }
    const scriptPath = resolvePath(args[0]);
    try {
      const scriptContent = await callHost('vfs_readFile', { path: scriptPath, asText: true });
      const lines = scriptContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        writeln(`$ ${trimmed}`);
        await executeCommandLine(trimmed);
      }
    } catch (err) {
      writeln(`sh: ${args[0]}: ${err.message}`);
    }
  },

  which: async (args) => {
    if (args.length === 0) return 0;
    for (const name of args) {
      if (['sh', 'ls', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'pwd', 'clear', 'echo', 'pushd', 'popd', 'dirs', 'push', 'pop'].includes(name)) {
        writeln(`/bin/${name}`);
      } else if (['gcc', 'clang', 'make', 'wasm-ld'].includes(name)) {
        writeln(`/usr/bin/${name}`);
      } else {
        const full = resolvePath(name);
        const exists = await callHost('vfs_exists', { path: full });
        if (exists) {
          writeln(full);
        } else {
          writeln(`which: no ${name} in (/usr/bin:/bin)`);
        }
      }
    }
    return 0;
  },
};

builtins.push = builtins.pushd;
builtins.pop = builtins.popd;

// Parser for chained shell commands with &&, ||, and ;
function parseCommandChain(line) {
  const commands = [];
  let current = '';
  let inQuotes = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === inQuotes) inQuotes = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuotes = ch;
      current += ch;
    } else if (ch === '&' && line[i + 1] === '&') {
      commands.push({ cmd: current.trim(), op: '&&' });
      current = '';
      i++;
    } else if (ch === '|' && line[i + 1] === '|') {
      commands.push({ cmd: current.trim(), op: '||' });
      current = '';
      i++;
    } else if (ch === ';') {
      commands.push({ cmd: current.trim(), op: ';' });
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    commands.push({ cmd: current.trim(), op: null });
  }

  return commands;
}

// Autocompletion
async function handleTabCompletion() {
  const tokens = parseArgs(lineBuffer);
  const lastToken = tokens.length > 0 && !lineBuffer.endsWith(' ') ? tokens[tokens.length - 1] : '';

  let searchDir = cwd;
  let prefix = lastToken;

  if (lastToken.includes('/')) {
    const slashIdx = lastToken.lastIndexOf('/');
    const dirPart = lastToken.substring(0, slashIdx);
    prefix = lastToken.substring(slashIdx + 1);
    searchDir = resolvePath(dirPart);
  }

  try {
    const items = await callHost('vfs_readDir', { path: searchDir });
    const matches = items.filter(it => it.name.startsWith(prefix));

    if (matches.length === 1) {
      const match = matches[0];
      const completion = match.name.substring(prefix.length) + (match.isDir ? '/' : ' ');
      lineBuffer += completion;
      cursorPos += completion.length;
      write(completion);
    } else if (matches.length > 1) {
      writeln('');
      writeln(matches.map(m => m.name + (m.isDir ? '/' : '')).join('  '));
      write(getPrompt() + lineBuffer);
    }
  } catch {}
}

// Parser for pipeline stages split by | (excluding || and quoted pipes)
function splitPipeline(line) {
  const stages = [];
  let current = '';
  let inQuotes = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === inQuotes) inQuotes = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuotes = ch;
      current += ch;
    } else if (ch === '|' && line[i + 1] !== '|' && (i === 0 || line[i - 1] !== '|')) {
      stages.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    stages.push(current.trim());
  }

  return stages;
}

// Parse redirections (<, >, >>) out of stage tokens
function parseStageRedirections(stageTokens) {
  const cleanTokens = [];
  let stdinRedirect = null;
  let stdoutRedirect = null; // { path: string, append: boolean }

  for (let i = 0; i < stageTokens.length; i++) {
    const token = stageTokens[i];
    if (!token.quoted) {
      if (token.text === '<') {
        const next = stageTokens[i + 1];
        if (next) {
          stdinRedirect = next.text;
          i++;
          continue;
        }
      } else if (token.text === '>') {
        const next = stageTokens[i + 1];
        if (next) {
          stdoutRedirect = { path: next.text, append: false };
          i++;
          continue;
        }
      } else if (token.text === '>>') {
        const next = stageTokens[i + 1];
        if (next) {
          stdoutRedirect = { path: next.text, append: true };
          i++;
          continue;
        }
      }
    }
    cleanTokens.push(token);
  }

  return { cleanTokens, stdinRedirect, stdoutRedirect };
}

// Execute single command line with operator chaining (&&, ||, ;) and pipelines (|)
async function executeCommandLine(commandStr) {
  const commands = parseCommandChain(commandStr);
  let lastExitCode = 0;
  let prevOp = null;

  for (let i = 0; i < commands.length; i++) {
    const { cmd: rawCmd, op } = commands[i];
    if (!rawCmd) continue;

    if (prevOp === '&&' && lastExitCode !== 0) {
      prevOp = op;
      continue;
    }
    if (prevOp === '||' && lastExitCode === 0) {
      prevOp = op;
      continue;
    }

    const stages = splitPipeline(rawCmd);
    let stageInput = null;
    let pipelineExitCode = 0;

    for (let s = 0; s < stages.length; s++) {
      const stageStr = stages[s];
      const isLast = (s === stages.length - 1);
      const stageTokens = parseTokens(stageStr);
      if (stageTokens.length === 0) continue;

      const { cleanTokens, stdinRedirect, stdoutRedirect } = parseStageRedirections(stageTokens);
      if (cleanTokens.length === 0) continue;

      const cmdToken = cleanTokens.shift();
      let cmd = cmdToken.text;

      // Expand globs in arguments
      const args = [];
      for (const token of cleanTokens) {
        if (token.quoted || !hasGlob(token.text)) {
          args.push(token.text);
        } else {
          const expanded = await expandGlobToken(token.text, cwd);
          args.push(...expanded);
        }
      }

      // Map path-prefixed commands like /bin/ls or /usr/bin/gcc
      const baseCmd = (cmd.startsWith('/bin/') || cmd.startsWith('/usr/bin/'))
        ? cmd.split('/').pop()
        : cmd;

      // Determine stdin data for this stage
      let currentStdinData = null;
      if (stdinRedirect) {
        const inPath = resolvePath(stdinRedirect);
        const exists = await callHost('vfs_exists', { path: inPath });
        if (!exists) {
          writeln(`${stdinRedirect}: No such file or directory`);
          pipelineExitCode = 1;
          break;
        }
        try {
          currentStdinData = await callHost('vfs_readFile', { path: inPath, asText: true });
        } catch (err) {
          writeln(`${stdinRedirect}: ${err.message}`);
          pipelineExitCode = 1;
          break;
        }
      } else if (stageInput !== null) {
        currentStdinData = stageInput;
      }

      // Determine stdout capturing
      const shouldCapture = !isLast || Boolean(stdoutRedirect);
      let captured = '';

      if (shouldCapture) {
        currentStdout = { data: '' };
      }
      currentStdin = currentStdinData;

      try {
        if (builtins[cmd] || builtins[baseCmd]) {
          const fn = builtins[cmd] || builtins[baseCmd];
          const res = await fn(args);
          pipelineExitCode = typeof res === 'number' ? res : 0;
          if (shouldCapture) {
            captured = currentStdout.data;
          }
        } else {
          const res = await callHost('exec_command', {
            cmd: baseCmd,
            args,
            rawLine: stageStr,
            cwd,
            stdinData: currentStdinData,
            captureStdout: shouldCapture,
            stdoutRedirect: null,
          });

          if (typeof res === 'object' && res !== null) {
            pipelineExitCode = res.exitCode;
            captured = res.stdout || '';
          } else {
            pipelineExitCode = 0;
          }
        }

        if (stdoutRedirect) {
          const outPath = resolvePath(stdoutRedirect.path);
          let fileContent = captured;
          if (stdoutRedirect.append) {
            try {
              const existing = await callHost('vfs_readFile', { path: outPath, asText: true });
              fileContent = existing + captured;
            } catch {
              fileContent = captured;
            }
          }
          await callHost('vfs_writeFile', { path: outPath, content: fileContent });
        }

        stageInput = captured;
      } catch (err) {
        writeln(err.message || `${cmd}: command not found`);
        pipelineExitCode = 1;
        break;
      } finally {
        currentStdout = null;
        currentStdin = null;
      }

      if (pipelineExitCode !== 0 && !isLast) {
        break;
      }
    }

    lastExitCode = pipelineExitCode;
    prevOp = op;
  }
}

let activeStdinReader = null;

function readInteractiveStdin(onLine) {
  return new Promise((resolve, reject) => {
    activeStdinReader = {
      currentLine: '',
      allText: '',
      onLine,
      resolve: (val) => {
        activeStdinReader = null;
        resolve(val);
      },
      reject: (err) => {
        activeStdinReader = null;
        reject(err);
      },
    };
  });
}

function handleInteractiveStdinKey(key) {
  if (!activeStdinReader) return;

  for (let i = 0; i < key.length; i++) {
    if (!activeStdinReader) return;
    const ch = key[i];

    // Ctrl+C
    if (ch === '\x03') {
      self.postMessage({ type: 'term_write', data: '^C\r\n' });
      activeStdinReader.reject(new Error('Interrupted'));
      return;
    }

    // Ctrl+D (EOF)
    if (ch === '\x04') {
      if (activeStdinReader.currentLine.length > 0) {
        const line = activeStdinReader.currentLine;
        activeStdinReader.currentLine = '';
        activeStdinReader.allText += line;
        if (activeStdinReader.onLine) {
          activeStdinReader.onLine(line);
        }
      } else {
        activeStdinReader.resolve(activeStdinReader.allText);
      }
      return;
    }

    // Enter
    if (ch === '\r' || ch === '\n') {
      self.postMessage({ type: 'term_write', data: '\r\n' });
      const lineWithNl = activeStdinReader.currentLine + '\n';
      activeStdinReader.currentLine = '';
      activeStdinReader.allText += lineWithNl;
      if (activeStdinReader.onLine) {
        activeStdinReader.onLine(lineWithNl);
      }
      continue;
    }

    // Backspace
    if (ch === '\x7f' || ch === '\x08') {
      if (activeStdinReader.currentLine.length > 0) {
        activeStdinReader.currentLine = activeStdinReader.currentLine.slice(0, -1);
        self.postMessage({ type: 'term_write', data: '\b \b' });
      }
      continue;
    }

    // Printable characters
    if (ch >= ' ') {
      activeStdinReader.currentLine += ch;
      self.postMessage({ type: 'term_write', data: ch });
    }
  }
}

// Input key handler
async function handleKey(key) {
  if (isExecuting) {
    if (activeStdinReader) {
      handleInteractiveStdinKey(key);
    }
    return;
  }

  // Enter
  if (key === '\r' || key === '\n') {
    writeln('');
    const toExecute = lineBuffer.trim();
    if (toExecute.length > 0) {
      history.push(toExecute);
    }

    if (toExecute.length > 0) {
      isExecuting = true;
      try {
        await executeCommandLine(toExecute);
      } catch (err) {
        writeln(`Error: ${err.message}`);
      } finally {
        isExecuting = false;
      }
    }

    showPrompt();
    return;
  }

  // Backspace
  if (key === '\x7f' || key === '\x08') {
    if (cursorPos > 0) {
      lineBuffer = lineBuffer.slice(0, cursorPos - 1) + lineBuffer.slice(cursorPos);
      cursorPos--;
      write('\b \b');
      if (cursorPos < lineBuffer.length) {
        const remaining = lineBuffer.slice(cursorPos);
        write(remaining + ' ' + '\b'.repeat(remaining.length + 1));
      }
    }
    return;
  }

  // Tab
  if (key === '\t') {
    await handleTabCompletion();
    return;
  }

  // Ctrl+C
  if (key === '\x03') {
    writeln('^C');
    showPrompt();
    return;
  }

  // Ctrl+D (EOF on empty prompt)
  if (key === '\x04') {
    if (lineBuffer.length === 0) {
      writeln('exit');
      showPrompt();
    }
    return;
  }

  // Arrow Keys
  if (key === '\x1b[A') {
    // Up arrow: history
    if (history.length > 0) {
      if (historyIndex === -1) historyIndex = history.length - 1;
      else if (historyIndex > 0) historyIndex--;

      write('\r\x1b[K' + getPrompt() + history[historyIndex]);
      lineBuffer = history[historyIndex];
      cursorPos = lineBuffer.length;
    }
    return;
  }

  if (key === '\x1b[B') {
    // Down arrow: history
    if (historyIndex !== -1) {
      if (historyIndex < history.length - 1) {
        historyIndex++;
        write('\r\x1b[K' + getPrompt() + history[historyIndex]);
        lineBuffer = history[historyIndex];
        cursorPos = lineBuffer.length;
      } else {
        historyIndex = -1;
        write('\r\x1b[K' + getPrompt());
        lineBuffer = '';
        cursorPos = 0;
      }
    }
    return;
  }

  if (key === '\x1b[D') {
    // Left arrow
    if (cursorPos > 0) {
      cursorPos--;
      write('\x1b[D');
    }
    return;
  }

  if (key === '\x1b[C') {
    // Right arrow
    if (cursorPos < lineBuffer.length) {
      cursorPos++;
      write('\x1b[C');
    }
    return;
  }

  // Printable characters
  if (key.length === 1 && key >= ' ') {
    lineBuffer = lineBuffer.slice(0, cursorPos) + key + lineBuffer.slice(cursorPos);
    cursorPos++;
    write(key);
    if (cursorPos < lineBuffer.length) {
      const remaining = lineBuffer.slice(cursorPos);
      write(remaining + '\b'.repeat(remaining.length));
    }
  }
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    cwd = msg.cwd || '/workspace';
    writeln('\x1b[1;36mWelcome to the In-Browser C/C++ Teaching IDE!\x1b[0m');
    writeln('Type \x1b[33mls\x1b[0m, \x1b[33mcat\x1b[0m, \x1b[33mcd\x1b[0m, \x1b[33mgcc\x1b[0m, \x1b[33msh\x1b[0m, or use the toolbar buttons.\r\n');
    showPrompt();
    return;
  }

  if (msg.type === 'input') {
    await handleKey(msg.data);
    return;
  }

  if (msg.type === 'rpc_response') {
    const pending = pendingRpcs.get(msg.id);
    if (pending) {
      pendingRpcs.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    }
    return;
  }

  if (msg.type === 'interrupt') {
    if (activeStdinReader) {
      activeStdinReader.reject(new Error('Interrupted'));
      activeStdinReader = null;
    }
    isExecuting = false;
    writeln('\r\n\x1b[31m[Process interrupted]\x1b[0m');
    showPrompt();
  }
};
