// Import resolver for eslint-plugin-boundaries (A-B14.1).
// Source files import `./foo.js` (NodeNext ESM) but the file on disk is `foo.ts`, which the
// default node resolver cannot find. This maps `.js` -> `.ts` for relative imports only; bare
// specifiers (packages, node:) are reported as not found, so the plugin treats them as external.
// Implements the eslint-module-utils resolver interface v2, so no extra dependency is needed.
const fs = require('node:fs');
const path = require('node:path');

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

exports.interfaceVersion = 2;

exports.resolve = (source, file) => {
  if (!source.startsWith('.')) return { found: false };
  const base = path.resolve(path.dirname(file), source);
  const stem = base.replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [
    base.endsWith('.js') ? `${stem}.ts` : null,
    base,
    `${base}.ts`,
    path.join(base, 'index.ts'),
  ].filter(Boolean);
  const hit = candidates.find(isFile);
  return hit ? { found: true, path: hit } : { found: false };
};
