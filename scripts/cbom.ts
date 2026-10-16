/**
 * Crypto Bill of Materials helpers (2.7 / A-B8.7). Scans production `src/` for
 * `node:crypto` imports and compares them to `docs/cbom.json`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface CbomSite {
  file: string;
  imports: string[];
  algorithms?: string[];
  purpose?: string;
  protects?: string;
}

export interface CbomDocument {
  version: number;
  sites: CbomSite[];
}

export interface CryptoImportSite {
  file: string;
  imports: string[];
}

export interface CbomFinding {
  file?: string;
  message: string;
}

/** Named import from node:crypto, including `sign as nodeSign` and `type KeyObject`. */
const NAMED_IMPORT =
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]node:crypto['"]/g;

/** Namespace or default import of the whole module. */
const WHOLE_IMPORT =
  /import\s+(?:\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]node:crypto['"]/g;

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'generated' || name === 'node_modules') continue;
      walkTsFiles(full, out);
      continue;
    }
    if (!name.endsWith('.ts') || name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/** Binding names imported from node:crypto (`sign as x` → `sign`). */
export function parseNodeCryptoImports(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(NAMED_IMPORT)) {
    for (const part of m[1].split(',')) {
      const raw = part.trim();
      if (!raw) continue;
      const withoutType = raw.replace(/^type\s+/, '');
      const base = withoutType.split(/\s+as\s+/)[0]?.trim();
      if (base) names.add(base);
    }
  }
  for (const m of source.matchAll(WHOLE_IMPORT)) {
    names.add(m[1] ?? m[2] ?? '*');
  }
  return [...names].sort();
}

export function scanSrc(root: string): CryptoImportSite[] {
  const srcRoot = join(root, 'src');
  const sites: CryptoImportSite[] = [];
  for (const abs of walkTsFiles(srcRoot)) {
    const source = readFileSync(abs, 'utf8');
    const imports = parseNodeCryptoImports(source);
    if (imports.length === 0) continue;
    sites.push({
      file: toPosix(relative(root, abs)),
      imports,
    });
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file));
}

export function loadCbom(root: string): CbomDocument {
  const raw = JSON.parse(
    readFileSync(join(root, 'docs', 'cbom.json'), 'utf8'),
  ) as CbomDocument;
  if (!Array.isArray(raw.sites))
    throw new Error('docs/cbom.json must have a sites array');
  return raw;
}

export function checkCbom(
  scanned: CryptoImportSite[],
  doc: CbomDocument,
): CbomFinding[] {
  const findings: CbomFinding[] = [];
  const listed = new Map(
    doc.sites.map((s) => [s.file, new Set(s.imports)] as const),
  );

  for (const site of scanned) {
    const expected = listed.get(site.file);
    if (!expected) {
      findings.push({
        file: site.file,
        message: `imports node:crypto (${site.imports.join(', ')}) but is not listed in docs/cbom.json`,
      });
      continue;
    }
    for (const name of site.imports) {
      if (!expected.has(name))
        findings.push({
          file: site.file,
          message: `imports ${name} from node:crypto but docs/cbom.json does not list it`,
        });
    }
    for (const name of expected) {
      if (!site.imports.includes(name))
        findings.push({
          file: site.file,
          message: `docs/cbom.json lists import ${name} which is not imported from node:crypto`,
        });
    }
    listed.delete(site.file);
  }

  for (const [file, imports] of listed) {
    findings.push({
      file,
      message: `listed in docs/cbom.json (${[...imports].join(', ') || 'no imports'}) but does not import node:crypto`,
    });
  }

  return findings;
}

export function checkProject(root: string): {
  scanned: number;
  listed: number;
  findings: CbomFinding[];
} {
  const scanned = scanSrc(root);
  const doc = loadCbom(root);
  return {
    scanned: scanned.length,
    listed: doc.sites.length,
    findings: checkCbom(scanned, doc),
  };
}
