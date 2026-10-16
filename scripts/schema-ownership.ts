import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import ts from 'typescript';

// Schemas each folder under src/modules/ may use. A module folder missing here fails the check,
// so every new module gets an explicit decision. Reads of other contexts go through their service.
export const OWNERSHIP: Readonly<Record<string, readonly string[]>> = {
  health: [],
  auth: ['auth'],
  users: ['auth'],
  b2b: [],
  wallets: ['wallet'],
  ledger: ['ledger'],
  transfers: ['ledger'],
  payments: ['payments'],
  withdrawals: ['withdrawals'],
  crypto: ['crypto'],
  // Outbox module writes every context outbox; business modules call OutboxService
  // instead of touching another context's table (A-B9.3).
  outbox: ['auth', 'wallet', 'ledger', 'payments', 'withdrawals'],
  // Chainer reads context outboxes (via audit.claim_outbox_row) and writes audit_events.
  audit: ['audit', 'auth', 'wallet', 'ledger', 'payments', 'withdrawals'],
  checkpoints: ['audit'],
  // PII scanner reads audit payloads (A-B11.5)
  privacy: ['privacy', 'audit'],
  // Search/export reads audit leaves; owns compliance schema for future export metadata
  compliance: ['compliance', 'audit'],
  reserves: ['reserves'],
};

export type EntityKind = 'model' | 'view' | 'enum';

export interface PrismaEntity {
  kind: EntityKind;
  name: string;
  schema: string;
  /** Table, view or type name in PostgreSQL (@@map, or the Prisma name). */
  dbName: string;
  file: string;
  line: number;
}

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export interface Usage {
  line: number;
  schema: string;
  /** What was found, e.g. `tx.user.findMany`, `type Prisma.UserCreateInput`, `SQL auth.users`. */
  what: string;
}

export interface SchemaIndex {
  schemas: ReadonlySet<string>;
  entities: readonly PrismaEntity[];
  /** Client delegate name (camelCase model name) -> entity. */
  delegates: ReadonlyMap<string, PrismaEntity>;
  /** Model, view and enum names, for generated type names. */
  byName: ReadonlyMap<string, PrismaEntity>;
  /** schema -> table / view names. */
  tables: ReadonlyMap<string, ReadonlySet<string>>;
  /** TypedSQL query name (prisma/sql/<name>.sql) -> schemas it reads or writes. */
  typedSql: ReadonlyMap<string, ReadonlySet<string>>;
}

const BLOCK_START = /^\s*(model|view|enum)\s+(\w+)\s*\{/;
const BLOCK_END = /^\s*\}/;
const SCHEMA_ATTR = /^\s*@@schema\(\s*"(\w+)"\s*\)/;
const MAP_ATTR = /^\s*@@map\(\s*"(\w+)"\s*\)/;
const DATASOURCE_SCHEMAS = /schemas\s*=\s*\[([^\]]*)\]/;

export function parseDatasourceSchemas(source: string): string[] {
  const list = DATASOURCE_SCHEMAS.exec(source)?.[1] ?? '';
  return [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** Models, views and enums of one .prisma file; a block without @@schema is reported. */
export function parsePrismaFile(
  source: string,
  file: string,
): { entities: PrismaEntity[]; findings: Finding[] } {
  const entities: PrismaEntity[] = [];
  const findings: Finding[] = [];
  let open: { kind: EntityKind; name: string; line: number } | undefined;
  let schema: string | undefined;
  let dbName: string | undefined;

  source.split('\n').forEach((text, i) => {
    if (!open) {
      const start = BLOCK_START.exec(text);
      if (start) {
        open = { kind: start[1] as EntityKind, name: start[2], line: i + 1 };
        schema = dbName = undefined;
      }
      return;
    }
    schema ??= SCHEMA_ATTR.exec(text)?.[1];
    dbName ??= MAP_ATTR.exec(text)?.[1];
    if (!BLOCK_END.test(text)) return;
    if (schema) {
      entities.push({ ...open, schema, dbName: dbName ?? open.name, file });
    } else {
      findings.push({
        file,
        line: open.line,
        message: `${open.kind} ${open.name} has no @@schema("<context>")`,
      });
    }
    open = undefined;
  });
  return { entities, findings };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "auth.users", "auth"."users", auth . users
const qualifiedNames = (sql: string) =>
  [...sql.matchAll(/"?\b(\w+)"?\s*\.\s*"?(\w+)\b"?/g)].map((m) => ({
    schema: m[1],
    table: m[2],
  }));

export function buildIndex(
  schemas: readonly string[],
  entities: readonly PrismaEntity[],
  sqlFiles: ReadonlyMap<string, string> = new Map(),
): SchemaIndex {
  const delegates = new Map<string, PrismaEntity>();
  const byName = new Map<string, PrismaEntity>();
  const tables = new Map<string, Set<string>>();
  for (const e of entities) {
    byName.set(e.name, e);
    if (e.kind === 'enum') continue;
    delegates.set(lowerFirst(e.name), e);
    if (!tables.has(e.schema)) tables.set(e.schema, new Set());
    tables.get(e.schema)!.add(e.dbName);
  }
  const typedSql = new Map<string, Set<string>>();
  for (const [name, sql] of sqlFiles) {
    const used = new Set(
      qualifiedNames(sql)
        .filter((q) => tables.get(q.schema)?.has(q.table))
        .map((q) => q.schema),
    );
    typedSql.set(name, used);
  }
  return {
    schemas: new Set(schemas),
    entities,
    delegates,
    byName,
    tables,
    typedSql,
  };
}

// Model delegate methods of the generated client (tx.user.findMany, prisma.ledgerEntry.create, ...)
const DELEGATE_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'fields',
]);

// Rest of a generated type name after the model name: UserCreateInput, UserWhereUniqueInput, UserGetPayload, ...
const GENERATED_SUFFIX =
  /^(?:$|Model\b|Delegate|Create|Update|Upsert|Delete|Where|Select|Include|Omit|OrderBy|GetPayload|Find|Count|Aggregate|GroupBy|ScalarFieldEnum|Scalar|Unchecked|Min|Max|Sum|Avg|Default|Args|Payload|CountOutputType)/;

const GENERATED_IMPORT = /(^|\/)generated\/prisma(\/|$)/;
const GENERATED_SQL_IMPORT = /(^|\/)generated\/prisma\/sql(\/|\.js$|$)/;

/** Entity behind a generated type name: exact model / enum name, or the longest model name prefix. */
export function entityForTypeName(
  name: string,
  index: SchemaIndex,
): PrismaEntity | undefined {
  const plain = name.replace(/^\$/, '');
  const exact = index.byName.get(plain);
  if (exact) return exact;
  let best: PrismaEntity | undefined;
  for (const e of index.entities) {
    if (e.kind === 'enum' || !plain.startsWith(e.name)) continue;
    if (!GENERATED_SUFFIX.test(plain.slice(e.name.length))) continue;
    if (!best || e.name.length > best.name.length) best = e;
  }
  return best;
}

/** Every use of a Prisma model, view, enum, table or TypedSQL query in one TypeScript file. */
export function findUsages(
  source: string,
  fileName: string,
  index: SchemaIndex,
): Usage[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const usages: Usage[] = [];
  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  // Local names bound to generated namespaces: Prisma, $Enums, `import * as x from '.../generated/prisma/...'`
  const typeNamespaces = new Set<string>();
  const sqlNamespaces = new Set<string>();

  const addType = (node: ts.Node, name: string, label: string) => {
    const e = entityForTypeName(name, index);
    if (e)
      usages.push({
        line: lineOf(node),
        schema: e.schema,
        what: `type ${label}`,
      });
  };
  const addSql = (node: ts.Node, name: string) => {
    for (const schema of index.typedSql.get(name) ?? [])
      usages.push({ line: lineOf(node), schema, what: `TypedSQL ${name}` });
  };
  const addSqlText = (node: ts.Node, text: string) => {
    for (const q of qualifiedNames(text))
      if (index.tables.get(q.schema)?.has(q.table))
        usages.push({
          line: lineOf(node),
          schema: q.schema,
          what: `SQL ${q.schema}.${q.table}`,
        });
  };

  const visitImport = (node: ts.ImportDeclaration) => {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const from = node.moduleSpecifier.text;
    if (!GENERATED_IMPORT.test(from)) return;
    const isSql = GENERATED_SQL_IMPORT.test(from);
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      (isSql ? sqlNamespaces : typeNamespaces).add(bindings.name.text);
      return;
    }
    // import { User } from '.../generated/prisma/models/User.js'
    const modelFile = /\/models\/(\w+)(\.js)?$/.exec(from)?.[1];
    if (modelFile) addType(node, modelFile, modelFile);
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (isSql) addSql(el, imported);
      else if (imported === 'Prisma' || imported === '$Enums')
        typeNamespaces.add(el.name.text);
      else addType(el, imported, imported);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      visitImport(node);
      return;
    }
    // Prisma.UserCreateInput as a type, $Enums.Role / sql.lockAccountsForUpdate as a value
    if (
      (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) ||
      (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression))
    ) {
      const left = ts.isQualifiedName(node)
        ? (node.left as ts.Identifier)
        : (node.expression as ts.Identifier);
      const right = ts.isQualifiedName(node) ? node.right : node.name;
      if (typeNamespaces.has(left.text))
        addType(node, right.text, `${left.text}.${right.text}`);
      else if (sqlNamespaces.has(left.text)) addSql(node, right.text);
    }
    // <client>.user.findMany(...)
    if (
      ts.isPropertyAccessExpression(node) &&
      DELEGATE_METHODS.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const e = index.delegates.get(node.expression.name.text);
      if (e)
        usages.push({
          line: lineOf(node),
          schema: e.schema,
          what: `${node.expression.getText(sf)}.${node.name.text}`,
        });
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      addSqlText(node, node.text);
    if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      addSqlText(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return usages;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const exists = (path: string) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

export interface CheckResult {
  findings: Finding[];
  entities: number;
  files: number;
}

/** Runs the whole check against a backend root (prisma/schema, prisma/sql, src/modules). */
export function checkProject(
  root: string,
  ownership: Readonly<Record<string, readonly string[]>> = OWNERSHIP,
): CheckResult {
  const rel = (p: string) => relative(root, p).split(sep).join('/');
  const findings: Finding[] = [];

  const schemaDir = join(root, 'prisma', 'schema');
  const prismaFiles = walk(schemaDir).filter((f) => f.endsWith('.prisma'));
  const schemas = prismaFiles.flatMap((f) =>
    parseDatasourceSchemas(readFileSync(f, 'utf8')),
  );
  if (schemas.length === 0)
    findings.push({
      file: rel(schemaDir),
      line: 0,
      message: 'no datasource `schemas = [...]` found',
    });

  const entities: PrismaEntity[] = [];
  for (const f of prismaFiles) {
    const parsed = parsePrismaFile(readFileSync(f, 'utf8'), rel(f));
    findings.push(...parsed.findings);
    const context = basename(f, '.prisma');
    for (const e of parsed.entities) {
      entities.push(e);
      if (!schemas.includes(e.schema))
        findings.push({
          file: e.file,
          line: e.line,
          message: `${e.kind} ${e.name}: schema "${e.schema}" is not in the datasource schemas`,
        });
      else if (schemas.includes(context) && e.schema !== context)
        findings.push({
          file: e.file,
          line: e.line,
          message: `${e.kind} ${e.name} has @@schema("${e.schema}") but lives in ${context}.prisma`,
        });
    }
  }

  for (const [module, owned] of Object.entries(ownership))
    for (const s of owned)
      if (!schemas.includes(s))
        findings.push({
          file: 'scripts/schema-ownership.ts',
          line: 0,
          message: `OWNERSHIP.${module} lists unknown schema "${s}"`,
        });

  const sqlDir = join(root, 'prisma', 'sql');
  const sqlFiles = new Map(
    (exists(sqlDir) ? walk(sqlDir) : [])
      .filter((f) => f.endsWith('.sql'))
      .map((f) => [basename(f, '.sql'), readFileSync(f, 'utf8')] as const),
  );
  const index = buildIndex(schemas, entities, sqlFiles);

  const modulesDir = join(root, 'src', 'modules');
  const files = exists(modulesDir)
    ? walk(modulesDir).filter((f) => /\.tsx?$/.test(f))
    : [];
  const unmapped = new Set<string>();
  for (const f of files) {
    const module = relative(modulesDir, f).split(sep)[0];
    const owned = ownership[module];
    if (!owned) {
      if (!unmapped.has(module))
        findings.push({
          file: rel(join(modulesDir, module)),
          line: 0,
          message: `module "${module}" has no entry in OWNERSHIP (scripts/schema-ownership.ts)`,
        });
      unmapped.add(module);
      continue;
    }
    for (const u of findUsages(readFileSync(f, 'utf8'), f, index))
      if (!owned.includes(u.schema))
        findings.push({
          file: rel(f),
          line: u.line,
          message: `${u.what} belongs to schema "${u.schema}"; module "${module}" owns ${
            owned.length ? owned.map((s) => `"${s}"`).join(', ') : 'no schema'
          }`,
        });
  }

  // The same table can appear twice in one SQL string
  const seen = new Set<string>();
  const unique = findings.filter((x) => {
    const key = `${x.file}:${x.line}:${x.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { findings: unique, entities: entities.length, files: files.length };
}
