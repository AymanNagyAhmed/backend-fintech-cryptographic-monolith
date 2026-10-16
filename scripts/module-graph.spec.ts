import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildGraph,
  findCycles,
  importsOf,
  renderMarkdown,
  type ModuleEdge,
} from './module-graph.js';

const edge = (from: string, to: string): ModuleEdge => ({
  from,
  to,
  imports: 1,
  typeOnly: 0,
});

describe('importsOf', () => {
  it('reads import and export-from specifiers and flags type-only ones', () => {
    expect(
      importsOf(`
        import { a } from '../a/a.service.js';
        import type { B } from '../b/b.js';
        import { type C, type D } from '../c/c.js';
        import { type E, f } from '../e/e.js';
        import '../side/effect.js';
        export { g } from '../g/g.js';
        export type { H } from '../h/h.js';
        const dynamic = 'not an import';
      `).map((i) => [i.specifier, i.typeOnly]),
    ).toEqual([
      ['../a/a.service.js', false],
      ['../b/b.js', true],
      ['../c/c.js', true],
      ['../e/e.js', false],
      ['../side/effect.js', false],
      ['../g/g.js', false],
      ['../h/h.js', true],
    ]);
  });
});

describe('findCycles', () => {
  it('finds no cycle in a DAG', () => {
    expect(
      findCycles([edge('a', 'b'), edge('a', 'c'), edge('b', 'c')]),
    ).toEqual([]);
  });

  it('finds a two-module and a longer cycle', () => {
    expect(
      findCycles([
        edge('a', 'b'),
        edge('b', 'a'),
        edge('x', 'y'),
        edge('y', 'z'),
        edge('z', 'x'),
        edge('a', 'x'),
      ]),
    ).toEqual([
      ['a', 'b'],
      ['x', 'y', 'z'],
    ]);
  });
});

describe('buildGraph', () => {
  let root: string;
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'module-graph-'));
    write(
      'wallets/wallets.service.ts',
      "import { x } from '../ledger/ledger.service.js';",
    );
    write(
      'wallets/dto/w.dto.ts',
      "import type { Y } from '../../ledger/dto/y.dto.js';",
    );
    write(
      'wallets/inner.ts',
      "import { z } from './dto/w.dto.js'; import pg from 'pg';",
    );
    write('ledger/ledger.service.ts', "import { c } from '../../common/c.js';");
    write('ledger/dto/y.dto.ts', '');
    write('health/health.module.ts', '');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('counts relative imports between modules, ignoring the same module and packages', () => {
    const graph = buildGraph(root);
    expect(graph.modules).toEqual(['health', 'ledger', 'wallets']);
    expect(graph.edges).toEqual([
      { from: 'wallets', to: 'ledger', imports: 2, typeOnly: 1 },
    ]);
  });

  it('detects a cycle introduced by a new import', () => {
    write(
      'ledger/ledger.service.ts',
      "import { w } from '../wallets/wallets.service.js';",
    );
    expect(findCycles(buildGraph(root).edges)).toEqual([['ledger', 'wallets']]);
  });

  it('renders every module and edge in the Mermaid graph', () => {
    const md = renderMarkdown(buildGraph(root));
    expect(md).toContain('flowchart LR');
    expect(md).toContain('health["health"]');
    expect(md).toContain('wallets["wallets"] --> ledger["ledger"]');
    expect(md).toContain('| wallets | ledger | 2 | 1 |');
  });
});
