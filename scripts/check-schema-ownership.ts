// Fails when a file under src/modules/<module>/ uses a Prisma model, enum, table or TypedSQL query
// of a schema the module does not own (OWNERSHIP in schema-ownership.ts). Run: npm run schema:ownership
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProject } from './schema-ownership.js';

const root = resolve(
  process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)),
);
const { findings, entities, files } = checkProject(root);

for (const f of findings)
  console.error(`${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}`);

const summary = `schema-ownership: ${entities} Prisma models/views/enums, ${files} module files, ${findings.length} violation(s)`;
if (findings.length > 0) {
  console.error(summary);
  process.exit(1);
}
console.log(summary);
