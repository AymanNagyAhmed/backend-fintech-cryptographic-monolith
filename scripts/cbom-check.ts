// Fails when a production src file imports node:crypto without a matching
// docs/cbom.json entry (or the entry drifts). Run: npm run cbom:check
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject } from './cbom.js';

const root = resolve(
  process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)),
);
const { scanned, listed, findings } = checkProject(root);

for (const f of findings)
  console.error(`${f.file ? `${f.file}  ` : ''}${f.message}`);

const summary = `cbom: ${scanned} src file(s) import node:crypto, ${listed} listed, ${findings.length} violation(s)`;
if (findings.length > 0) {
  console.error(summary);
  process.exit(1);
}
console.log(summary);
