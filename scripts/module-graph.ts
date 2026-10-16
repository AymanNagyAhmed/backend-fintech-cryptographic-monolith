import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// Module dependency graph of src/modules/<name>/ (A-B14.5): an edge A -> B for every relative
// import from a file of A into a file of B. Type-only imports count too (they still couple
// the contracts). Cycles between modules fail the check; the Mermaid graph lives in
// docs/modules.md. Run: npm run modules:graph  (npm run modules:graph -- --check in CI).

export interface ModuleEdge {
  from: string;
  to: string;
  /** Import declarations from `from` into `to`. */
  imports: number;
  /** How many of them are `import type` / `export type`. */
  typeOnly: number;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Module specifiers of the import / export-from declarations in one file, with their kind. */
export function importsOf(
  source: string,
  fileName = 'x.ts',
): { specifier: string; typeOnly: boolean }[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const out: { specifier: string; typeOnly: boolean }[] = [];
  for (const node of sf.statements) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            !!named &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((e) => e.isTypeOnly)));
      out.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly,
      });
    }
  }
  return out;
}

/** Edges between module folders under `modulesDir`; imports inside one module are ignored. */
export function buildGraph(modulesDir: string): {
  modules: string[];
  edges: ModuleEdge[];
} {
  const modules = readdirSync(modulesDir)
    .filter((n) => statSync(join(modulesDir, n)).isDirectory())
    .sort();
  const moduleOf = (path: string): string | undefined => {
    const rel = relative(modulesDir, path);
    if (rel.startsWith('..')) return undefined;
    return rel.split(sep)[0];
  };
  const edges = new Map<string, ModuleEdge>();
  for (const file of walk(modulesDir).filter((f) => /\.tsx?$/.test(f))) {
    const from = moduleOf(file);
    if (!from) continue;
    for (const { specifier, typeOnly } of importsOf(
      readFileSync(file, 'utf8'),
      file,
    )) {
      if (!specifier.startsWith('.')) continue;
      const to = moduleOf(resolve(dirname(file), specifier));
      if (!to || to === from || !modules.includes(to)) continue;
      const key = `${from}>${to}`;
      const edge = edges.get(key) ?? { from, to, imports: 0, typeOnly: 0 };
      edge.imports += 1;
      if (typeOnly) edge.typeOnly += 1;
      edges.set(key, edge);
    }
  }
  return {
    modules,
    edges: [...edges.values()].sort((a, b) =>
      `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`),
    ),
  };
}

/** Strongly connected components with more than one module (Tarjan), each sorted. */
export function findCycles(edges: readonly ModuleEdge[]): string[][] {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const nodes = new Set(edges.flatMap((e) => [e.from, e.to]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const n of [...nodes].sort()) if (!index.has(n)) visit(n);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

/** docs/modules.md: Mermaid graph (dashed = only `import type`) and an edge table. */
export function renderMarkdown(graph: {
  modules: string[];
  edges: readonly ModuleEdge[];
}): string {
  const connected = new Set(graph.edges.flatMap((e) => [e.from, e.to]));
  const lines = [
    '# Module dependency graph',
    '',
    'Generated by `npm run modules:graph` from the relative imports under `src/modules/`; do not edit by hand.',
    'An arrow `A --> B` means a file of A imports a file of B. Dashed arrows are type-only imports.',
    'Cycles between modules fail `npm run modules:graph` (file-level cycles fail `npm run lint`).',
    '',
    '```mermaid',
    'flowchart LR',
    ...graph.modules
      .filter((m) => !connected.has(m))
      .map((m) => `  ${m.replace(/\W/g, '_')}["${m}"]`),
    ...graph.edges.map((e) => {
      const arrow = e.typeOnly === e.imports ? '-.->' : '-->';
      const id = (m: string) => m.replace(/\W/g, '_');
      return `  ${id(e.from)}["${e.from}"] ${arrow} ${id(e.to)}["${e.to}"]`;
    }),
    '```',
    '',
    '| From | To | Imports | Type-only |',
    '|---|---|---:|---:|',
    ...graph.edges.map(
      (e) => `| ${e.from} | ${e.to} | ${e.imports} | ${e.typeOnly} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
