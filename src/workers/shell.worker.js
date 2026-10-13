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

// Shell output helpers
function write(str) {
  self.postMessage({ type: 'term_write', data: str });
}

function writeln(str = '') {
  self.postMessage({ type: 'term_write', data: str + '\r\n' });
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

// Command line tokenizer
function parseArgs(line) {
  const args = [];
  let current = '';
  let inQuotes = null;

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
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

// Built-in POSIX CLI Commands
const builtins = {
  pwd: async () => {
    writeln(cwd);
  },

  cd: async (args) => {
    const target = args[0] ? resolvePath(args[0]) : '/workspace';
    try {
      const exists = await callHost('vfs_exists', { path: target });
      if (!exists) {
        writeln(`cd: no such file or directory: ${args[0]}`);
        return;
      }
      const stat = await callHost('vfs_stat', { path: target });
      if (!stat || !stat.isDir) {
        writeln(`cd: not a directory: ${args[0]}`);
        return;
      }
      cwd = target;
    } catch (err) {
      writeln(`cd: ${err.message}`);
    }
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

    const target = paths.length > 0 ? resolvePath(paths[0]) : cwd;

    try {
      const items = await callHost('vfs_readDir', { path: target });
      const filtered = showAll ? items : items.filter(it => !it.name.startsWith('.'));

      if (longFormat) {
        for (const item of filtered) {
          const typeChar = item.isDir ? 'd' : '-';
          const sizeStr = String(item.size).padStart(8, ' ');
          const nameColored = item.isDir
            ? `\x1b[1;34m${item.name}\x1b[0m`
            : item.name.endsWith('.out') || item.name.endsWith('.wasm')
            ? `\x1b[1;32m${item.name}\x1b[0m`
            : item.name;
          writeln(`${typeChar}rwxr-xr-x 1 user staff ${sizeStr} ${nameColored}`);
        }
      } else {
        const names = filtered.map(item => {
          if (item.isDir) return `\x1b[1;34m${item.name}/\x1b[0m`;
          if (item.name.endsWith('.out') || item.name.endsWith('.wasm')) return `\x1b[1;32m${item.name}\x1b[0m`;
          return item.name;
        });
        writeln(names.join('  '));
      }
    } catch (err) {
      writeln(`ls: cannot access '${target}': ${err.message}`);
    }
  },

  cat: async (args) => {
    if (args.length === 0) return;
    for (const arg of args) {
      const target = resolvePath(arg);
      try {
        const content = await callHost('vfs_readFile', { path: target, asText: true });
        write(content.endsWith('\n') ? content : content + '\r\n');
      } catch (err) {
        writeln(`cat: ${arg}: No such file or directory`);
      }
    }
  },

  echo: async (args) => {
    // Check for redirection > or >>
    const redirectIdx = args.findIndex(a => a === '>' || a === '>>');
    if (redirectIdx !== -1 && redirectIdx < args.length - 1) {
      const text = args.slice(0, redirectIdx).join(' ') + '\n';
      const isAppend = args[redirectIdx] === '>>';
      const targetPath = resolvePath(args[redirectIdx + 1]);
      try {
        let content = text;
        if (isAppend) {
          const existing = await callHost('vfs_readFile', { path: targetPath, asText: true }).catch(() => '');
          content = existing + text;
        }
        await callHost('vfs_writeFile', { path: targetPath, content });
      } catch (err) {
        writeln(`echo: cannot write to '${args[redirectIdx + 1]}': ${err.message}`);
      }
      return;
    }

    writeln(args.join(' '));
  },

  mkdir: async (args) => {
    let recursive = false;
    const dirs = [];
    for (const arg of args) {
      if (arg === '-p') recursive = true;
      else dirs.push(arg);
    }
    for (const dir of dirs) {
      const target = resolvePath(dir);
      try {
        await callHost('vfs_mkdir', { path: target, recursive });
      } catch (err) {
        writeln(`mkdir: cannot create directory '${dir}': ${err.message}`);
      }
    }
  },

  rm: async (args) => {
    let recursive = false;
    const targets = [];
    for (const arg of args) {
      if (arg === '-r' || arg === '-rf' || arg === '-f') recursive = true;
      else targets.push(arg);
    }
    for (const target of targets) {
      const resolved = resolvePath(target);
      try {
        await callHost('vfs_remove', { path: resolved, recursive });
      } catch (err) {
        if (!args.includes('-f') && !args.includes('-rf')) {
          writeln(`rm: cannot remove '${target}': ${err.message}`);
        }
      }
    }
  },

  cp: async (args) => {
    if (args.length < 2) {
      writeln('cp: missing file operand');
      return;
    }
    const src = resolvePath(args[0]);
    const dst = resolvePath(args[1]);
    try {
      const content = await callHost('vfs_readFile', { path: src, asText: false });
      await callHost('vfs_writeFile', { path: dst, content });
    } catch (err) {
      writeln(`cp: cannot copy '${args[0]}' to '${args[1]}': ${err.message}`);
    }
  },

  mv: async (args) => {
    if (args.length < 2) {
      writeln('mv: missing file operand');
      return;
    }
    const src = resolvePath(args[0]);
    const dst = resolvePath(args[1]);
    try {
      await callHost('vfs_rename', { oldPath: src, newPath: dst });
    } catch (err) {
      writeln(`mv: cannot move '${args[0]}' to '${args[1]}': ${err.message}`);
    }
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
    if (args.length === 0) return;
    for (const name of args) {
      if (['sh', 'ls', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'pwd', 'clear', 'echo'].includes(name)) {
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
  },
};

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

// Execute single command line
async function executeCommandLine(commandStr) {
  const parts = commandStr.split('&&');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const args = parseArgs(trimmed);
    let cmd = args.shift();

    // Map path-prefixed commands like /bin/ls or /usr/bin/gcc
    const baseCmd = (cmd.startsWith('/bin/') || cmd.startsWith('/usr/bin/'))
      ? cmd.split('/').pop()
      : cmd;

    if (builtins[cmd]) {
      await builtins[cmd](args);
    } else if (builtins[baseCmd]) {
      await builtins[baseCmd](args);
    } else {
      // Delegate external command (gcc, clang, make, ./a.out) to host
      try {
        await callHost('exec_command', { cmd: baseCmd, args, rawLine: trimmed, cwd });
      } catch (err) {
        writeln(err.message || `${cmd}: command not found`);
      }
    }
  }
}

// Input key handler
async function handleKey(key) {
  if (isExecuting) return;

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
    isExecuting = false;
    writeln('\r\n\x1b[31m[Process interrupted]\x1b[0m');
    showPrompt();
  }
};
