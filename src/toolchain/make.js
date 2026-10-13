// Educational Makefile Parser and Runner
// Evaluates targets, dependencies, mtime staleness, and runs recipes

export function parseMakefile(content) {
  const lines = content.split('\n');
  const vars = new Map();
  const targets = new Map(); // targetName -> { prereqs: [], recipes: [] }
  let currentTarget = null;

  for (let rawLine of lines) {
    // Variable definition: VAR = VAL
    const varMatch = rawLine.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (varMatch && !rawLine.startsWith('\t')) {
      vars.set(varMatch[1], varMatch[2].trim());
      currentTarget = null;
      continue;
    }

    // Substitute variables $(VAR) across the line
    let expandedLine = rawLine;
    for (const [k, v] of vars.entries()) {
      expandedLine = expandedLine.split(`$(${k})`).join(v);
    }

    // Recipe line (starts with tab)
    if (rawLine.startsWith('\t')) {
      if (currentTarget) {
        let recipe = expandedLine.substring(1).trim();
        currentTarget.recipes.push(recipe);
      }
      continue;
    }

    // Target line: target: prereq1 prereq2 | order_only
    const targetMatch = expandedLine.match(/^([A-Za-z0-9_./%-]+)\s*:\s*(.*)$/);
    if (targetMatch) {
      const name = targetMatch[1].trim();
      let prereqStr = targetMatch[2].trim();

      const prereqs = prereqStr
        .split('|')[0] // discard order-only separator
        .split(/\s+/)
        .map(p => p.trim())
        .filter(Boolean);

      const targetObj = { prereqs, recipes: [] };
      targets.set(name, targetObj);
      currentTarget = targetObj;
    }
  }

  return { vars, targets };
}

export async function runMake({
  targetName = 'all',
  vfs,
  write,
  executeCommand,
}) {
  if (!vfs.exists('/workspace/Makefile')) {
    write('make: *** No targets specified and no makefile found. Stop.\r\n');
    return 2;
  }

  const makefileContent = vfs.readFile('/workspace/Makefile');
  const { targets } = parseMakefile(makefileContent);

  if (targets.size === 0) {
    write('make: *** No targets found in Makefile. Stop.\r\n');
    return 2;
  }

  // Resolve root target
  let effectiveTarget = targetName;
  if (effectiveTarget === 'all' && !targets.has('all')) {
    effectiveTarget = targets.keys().next().value;
  }

  const target = targets.get(effectiveTarget);
  if (!target) {
    write(`make: *** No rule to make target '${effectiveTarget}'. Stop.\r\n`);
    return 2;
  }

  let executedAny = false;

  async function buildTarget(name) {
    const t = targets.get(name);
    if (!t) return;

    // Build prerequisites first
    for (const prereq of t.prereqs) {
      if (targets.has(prereq)) {
        await buildTarget(prereq);
      }
    }

    // Check if target needs rebuilding
    const targetPath = `/workspace/${name}`;
    const targetStat = vfs.stat(targetPath);

    let needsBuild = false;
    if (!targetStat) {
      needsBuild = true;
    } else {
      // Check mtime against prerequisites
      for (const prereq of t.prereqs) {
        const prereqPath = `/workspace/${prereq}`;
        const prereqStat = vfs.stat(prereqPath);
        if (prereqStat && prereqStat.mtime > targetStat.mtime) {
          needsBuild = true;
          break;
        }
      }
    }

    // Always run phony targets like clean or all
    if (name === 'clean' || name === 'all' || name === 'build') {
      needsBuild = true;
    }

    if (needsBuild && t.recipes.length > 0) {
      for (const recipe of t.recipes) {
        write(`${recipe}\r\n`);
        executedAny = true;
        await executeCommand(recipe);
      }
    }
  }

  await buildTarget(effectiveTarget);

  if (!executedAny && effectiveTarget !== 'clean') {
    write(`make: '${effectiveTarget}' is up to date.\r\n`);
  }

  return 0;
}
