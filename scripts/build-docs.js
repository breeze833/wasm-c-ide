// scripts/build-docs.js - Builds public user-facing API documentation from ide-docs/ into dist/docs/ and public/docs/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceDir = path.join(projectRoot, 'ide-docs');
const targetPublicDir = path.join(projectRoot, 'public', 'docs');
const targetDistDir = path.join(projectRoot, 'dist', 'docs');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function buildDocs() {
  console.log(`[Docs Build] Copying API docs from ${sourceDir}...`);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory ide-docs does not exist at ${sourceDir}`);
  }

  // 1. Populate public/docs (for Vite dev server and standard vite build)
  copyRecursive(sourceDir, targetPublicDir);
  console.log(`✓ Populated ${targetPublicDir}`);

  // 2. Populate dist/docs if dist/ exists
  copyRecursive(sourceDir, targetDistDir);
  console.log(`✓ Populated ${targetDistDir}`);

  console.log('[Docs Build] API documentation build completed successfully.');
}

// Run directly if invoked via CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    buildDocs();
  } catch (err) {
    console.error('[Docs Build Error]:', err);
    process.exit(1);
  }
}
