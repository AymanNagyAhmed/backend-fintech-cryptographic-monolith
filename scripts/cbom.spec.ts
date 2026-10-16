import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkCbom,
  checkProject,
  parseNodeCryptoImports,
  scanSrc,
  type CbomDocument,
} from './cbom.js';

describe('parseNodeCryptoImports', () => {
  it('collects named imports including aliases and type-only', () => {
    expect(
      parseNodeCryptoImports(`
        import { createHash, sign as nodeSign, type KeyObject } from 'node:crypto';
        import type { KeyObject as K } from "node:crypto";
      `),
    ).toEqual(['KeyObject', 'createHash', 'sign']);
  });

  it('records namespace imports', () => {
    expect(
      parseNodeCryptoImports(`import * as crypto from 'node:crypto';`),
    ).toEqual(['crypto']);
  });
});

describe('cbom check', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cbom-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writeCbom = (doc: CbomDocument) =>
    writeFileSync(join(root, 'docs', 'cbom.json'), JSON.stringify(doc));

  it('passes when inventory matches scanned imports', () => {
    writeFileSync(
      join(root, 'src', 'hash.ts'),
      `import { createHash } from 'node:crypto';\n`,
    );
    writeCbom({
      version: 1,
      sites: [{ file: 'src/hash.ts', imports: ['createHash'] }],
    });
    expect(checkProject(root).findings).toEqual([]);
  });

  it('fails when a call site is missing from the CBOM', () => {
    writeFileSync(
      join(root, 'src', 'hash.ts'),
      `import { createHash } from 'node:crypto';\n`,
    );
    writeCbom({ version: 1, sites: [] });
    const findings = checkProject(root).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/not listed/);
  });

  it('fails when the CBOM lists a stale or wrong import', () => {
    writeFileSync(
      join(root, 'src', 'hash.ts'),
      `import { createHash } from 'node:crypto';\n`,
    );
    const findings = checkCbom(scanSrc(root), {
      version: 1,
      sites: [{ file: 'src/hash.ts', imports: ['createHmac'] }],
    });
    expect(findings.map((f) => f.message).join('\n')).toMatch(/createHash/);
    expect(findings.map((f) => f.message).join('\n')).toMatch(/createHmac/);
  });

  it('ignores unit specs under src', () => {
    writeFileSync(
      join(root, 'src', 'hash.spec.ts'),
      `import { createHash } from 'node:crypto';\n`,
    );
    writeCbom({ version: 1, sites: [] });
    expect(scanSrc(root)).toEqual([]);
  });
});
