// Builds the module dependency graph, fails on a cycle between modules, and writes
// docs/modules.md (or, with --check, fails when the committed file is out of date).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, findCycles, renderMarkdown } from './module-graph.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outFile = resolve(root, 'docs', 'modules.md');
const check = process.argv.includes('--check');

const graph = buildGraph(resolve(root, 'src', 'modules'));
const cycles = findCycles(graph.edges);
for (const c of cycles)
  console.error(`cycle between modules: ${c.join(' <-> ')}`);

const markdown = renderMarkdown(graph);
let stale = false;
if (check) {
  const current = (() => {
    try {
      return readFileSync(outFile, 'utf8');
    } catch {
      return '';
    }
  })();
  stale = current !== markdown;
  if (stale)
    console.error('docs/modules.md is out of date; run npm run modules:graph');
} else {
  writeFileSync(outFile, markdown);
}

console.log(
  `module-graph: ${graph.modules.length} modules, ${graph.edges.length} dependencies, ${cycles.length} cycle(s)${check ? '' : ', wrote docs/modules.md'}`,
);
if (cycles.length > 0 || stale) process.exit(1);
