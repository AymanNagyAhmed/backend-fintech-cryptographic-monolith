import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildIndex,
  checkProject,
  crossSchemaJoin,
  findCrossSchemaForeignKeys,
  findCrossSchemaJoins,
  findCrossSchemaRelations,
  findUsages,
  parseDatasourceSchemas,
  parsePrismaFile,
} from './schema-ownership.js';

const BASE = `
datasource db {
  provider = "postgresql"
  schemas  = ["auth", "wallet", "ledger", "payments", "withdrawals", "audit", "crypto", "privacy", "compliance", "reserves"]
}`;

const AUTH = `
// model Commented { }
model User {
  id    String @id @db.Uuid
  email String @unique // a "}" in a comment
  role  Role
  @@map("users")
  @@schema("auth")
}

enum Role {
  user
  admin
  @@schema("auth")
}`;

const LEDGER = `
model LedgerEntry {
  id String @id @db.Uuid
  @@map("ledger_entries")
  @@schema("ledger")
}

model Account {
  id String @id @db.Uuid
  @@map("accounts")
  @@schema("ledger")
}`;

const LOCK_SQL = `SELECT id, balance FROM ledger.accounts WHERE id = ANY($1::uuid[]) FOR UPDATE`;

const entities = [
  ...parsePrismaFile(AUTH, 'auth.prisma').entities,
  ...parsePrismaFile(LEDGER, 'ledger.prisma').entities,
];
const index = buildIndex(
  parseDatasourceSchemas(BASE),
  entities,
  new Map([['lockAccountsForUpdate', LOCK_SQL]]),
);
const schemasIn = (source: string) =>
  findUsages(source, 'x.ts', index).map((u) => `${u.schema} ${u.what}`);

describe('parsePrismaFile', () => {
  it('reads models and enums with their schema and table name', () => {
    expect(
      parsePrismaFile(AUTH, 'auth.prisma').entities.map((e) => [
        e.kind,
        e.name,
        e.schema,
        e.dbName,
      ]),
    ).toEqual([
      ['model', 'User', 'auth', 'users'],
      ['enum', 'Role', 'auth', 'Role'],
    ]);
  });

  it('reports a block without @@schema', () => {
    const { findings } = parsePrismaFile(
      'model Orphan {\n  id String @id\n}',
      'wallet.prisma',
    );
    expect(findings).toEqual([
      {
        file: 'wallet.prisma',
        line: 1,
        message: 'model Orphan has no @@schema("<context>")',
      },
    ]);
  });

  it('reads the datasource schemas', () => {
    expect(parseDatasourceSchemas(BASE)).toHaveLength(10);
    expect(parseDatasourceSchemas(BASE).slice(0, 3)).toEqual([
      'auth',
      'wallet',
      'ledger',
    ]);
  });
});

describe('findUsages', () => {
  it('finds client delegate calls on any client or transaction', () => {
    expect(
      schemasIn(`
        await tx.user.findUnique({ where: { id } });
        await this.prisma.ledgerEntry.createMany({ data });
      `),
    ).toEqual([
      'auth tx.user.findUnique',
      'ledger this.prisma.ledgerEntry.createMany',
    ]);
  });

  it('ignores same-named properties that are not delegate calls', () => {
    expect(schemasIn('const id = req.user.id; req.user.toString();')).toEqual(
      [],
    );
  });

  it('finds generated types and enums by import and by Prisma namespace', () => {
    expect(
      schemasIn(`
        import { Prisma, Role, type User as U } from '../../generated/prisma/client.js';
        import type { AccountModel } from '../../generated/prisma/models/Account.js';
        type In = Prisma.UserCreateInput;
        const level = Prisma.TransactionIsolationLevel.ReadCommitted;
      `),
    ).toEqual([
      'auth type Role',
      'auth type User',
      'ledger type Account',
      'ledger type AccountModel',
      'auth type Prisma.UserCreateInput',
    ]);
  });

  it('picks the longest model name for a generated type', () => {
    const idx = buildIndex(
      ['auth', 'wallet'],
      [
        ...parsePrismaFile('model User {\n@@schema("auth")\n}', 'a').entities,
        ...parsePrismaFile('model UserWallet {\n@@schema("wallet")\n}', 'w')
          .entities,
      ],
    );
    expect(
      findUsages(
        `import { Prisma } from '../generated/prisma/client.js';
         type A = Prisma.UserWalletWhereInput;`,
        'x.ts',
        idx,
      ).map((u) => u.schema),
    ).toEqual(['wallet']);
  });

  it('finds schema-qualified tables in raw SQL, quoted or not', () => {
    expect(
      schemasIn(
        'await tx.$queryRaw`SELECT * FROM "auth"."users" u JOIN ledger.accounts a ON a.id = ${id}`;',
      ),
    ).toEqual(['auth SQL auth.users', 'ledger SQL ledger.accounts']);
  });

  it('does not treat event names or unknown tables as SQL', () => {
    expect(
      schemasIn(
        `emit('ledger.posted'); log('auth.login'); q('SELECT 1 FROM ledger.unknown');`,
      ),
    ).toEqual([]);
  });

  it('finds TypedSQL queries by named or namespace import', () => {
    expect(
      schemasIn(`
        import { lockAccountsForUpdate } from '../../generated/prisma/sql/index.js';
        import * as sql from '../../generated/prisma/sql.js';
        await tx.$queryRawTyped(sql.lockAccountsForUpdate(ids));
      `),
    ).toEqual([
      'ledger TypedSQL lockAccountsForUpdate',
      'ledger TypedSQL lockAccountsForUpdate',
    ]);
  });

  it('ignores comments', () => {
    expect(schemasIn('// tx.user.findMany()\n/* auth.users */')).toEqual([]);
  });
});

describe('checkProject', () => {
  let root: string;
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'schema-ownership-'));
    write('prisma/schema/base.prisma', BASE);
    write('prisma/schema/auth.prisma', AUTH);
    write('prisma/schema/ledger.prisma', LEDGER);
    write('prisma/sql/lockAccountsForUpdate.sql', LOCK_SQL);
    write(
      'src/modules/users/users.service.ts',
      'export const find = (tx: any) => tx.user.findMany();',
    );
    write(
      'src/modules/transfers/transfers.service.ts',
      `import { lockAccountsForUpdate } from '../../generated/prisma/sql.js';
       export const post = (tx: any) => tx.ledgerEntry.create({});`,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes when every module uses only its own schemas', () => {
    expect(checkProject(root)).toEqual({ findings: [], entities: 4, files: 2 });
  });

  it('fails when a module uses another context', () => {
    write(
      'src/modules/wallets/wallets.service.ts',
      [
        "import type { User } from '../../generated/prisma/client.js';",
        'export const owner = (tx: any) => tx.user.findUnique({});',
        'export const bal = (tx: any) => tx.$queryRaw`SELECT balance FROM ledger.accounts`;',
      ].join('\n'),
    );
    expect(checkProject(root).findings).toEqual([
      {
        file: 'src/modules/wallets/wallets.service.ts',
        line: 1,
        message:
          'type User belongs to schema "auth"; module "wallets" owns "wallet"',
      },
      {
        file: 'src/modules/wallets/wallets.service.ts',
        line: 2,
        message:
          'tx.user.findUnique belongs to schema "auth"; module "wallets" owns "wallet"',
      },
      {
        file: 'src/modules/wallets/wallets.service.ts',
        line: 3,
        message:
          'SQL ledger.accounts belongs to schema "ledger"; module "wallets" owns "wallet"',
      },
    ]);
  });

  it('fails for a module folder without an OWNERSHIP entry, once per module', () => {
    write('src/modules/newmodule/a.ts', '');
    write('src/modules/newmodule/b.ts', '');
    expect(checkProject(root).findings).toEqual([
      {
        file: 'src/modules/newmodule',
        line: 0,
        message:
          'module "newmodule" has no entry in OWNERSHIP (scripts/schema-ownership.ts)',
      },
    ]);
  });

  it('fails when a model sits in the wrong context file or schema list', () => {
    write(
      'prisma/schema/wallet.prisma',
      'model Wallet {\n  @@schema("auth")\n}\nmodel Stray {\n  @@schema("billing")\n}',
    );
    expect(checkProject(root).findings.map((f) => f.message)).toEqual([
      'model Wallet has @@schema("auth") but lives in wallet.prisma',
      'model Stray: schema "billing" is not in the datasource schemas',
    ]);
  });

  it('fails when OWNERSHIP names a schema the datasource does not have', () => {
    expect(
      checkProject(root, { users: ['auth', 'nope'] }).findings.map(
        (f) => f.message,
      ),
    ).toContain('OWNERSHIP.users lists unknown schema "nope"');
  });
});

describe('cross-schema links (A-B14.2)', () => {
  it('flags a Prisma relation to a model of another schema, not one inside the schema', () => {
    const wallet = parsePrismaFile(
      `model Wallet {
        id      String @id
        owner   User   @relation(fields: [ownerId], references: [id])
        entries Entry[]
        role    Role
        @@schema("wallet")
      }
      model Entry {
        id String @id
        @@schema("wallet")
      }`,
      'wallet.prisma',
    ).entities;
    expect(
      findCrossSchemaRelations([...wallet, ...entities]).map((f) => [
        f.file,
        f.line,
        f.message.split(';')[0],
      ]),
    ).toEqual([
      ['wallet.prisma', 3, 'Wallet.owner relates to User in schema "auth"'],
    ]);
  });

  it('flags a JOIN across schemas in SQL, not a same-schema JOIN or a UNION of counts', () => {
    expect(
      crossSchemaJoin(
        'SELECT 1 FROM ledger.accounts a JOIN auth.users u ON u.id = a.id',
        index,
      ),
    ).toEqual(['auth', 'ledger']);
    expect(
      crossSchemaJoin(
        'SELECT 1 FROM ledger.accounts a JOIN ledger.ledger_entries e ON e.id = a.id',
        index,
      ),
    ).toBeUndefined();
    expect(
      crossSchemaJoin(
        'SELECT (SELECT 1 FROM ledger.accounts) + (SELECT 1 FROM auth.users)',
        index,
      ),
    ).toBeUndefined();
  });

  it('finds cross-schema JOINs in TypeScript SQL strings and templates', () => {
    expect(
      findCrossSchemaJoins(
        [
          'const a = tx.$queryRaw`SELECT 1 FROM auth.users u JOIN ledger.accounts a ON a.id = ${id}`;',
          "const b = 'SELECT 1 FROM ledger.accounts a JOIN ledger.ledger_entries e ON true';",
        ].join('\n'),
        'x.ts',
        index,
      ),
    ).toEqual([{ line: 1, schemas: ['auth', 'ledger'] }]);
  });

  it('flags a foreign key into another schema, not one inside the schema', () => {
    const sql = [
      'ALTER TABLE "ledger"."ledger_entries" ADD CONSTRAINT "a" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id");',
      'CREATE TABLE "wallet"."wallets" (',
      '  "id" uuid PRIMARY KEY,',
      '  "owner_id" uuid REFERENCES "auth"."users"("id")',
      ');',
    ].join('\n');
    expect(findCrossSchemaForeignKeys(sql, 'm.sql')).toEqual([
      {
        file: 'm.sql',
        line: 4,
        message:
          'foreign key from wallet.wallets references auth.users; no cross-schema foreign keys',
      },
    ]);
  });

  it('checkProject reports all three kinds', () => {
    const root = mkdtempSync(join(tmpdir(), 'schema-ownership-'));
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    };
    try {
      write('prisma/schema/base.prisma', BASE);
      write(
        'prisma/schema/auth.prisma',
        AUTH.replace('role  Role', 'role  Role\n  acct  Account'),
      );
      write('prisma/schema/ledger.prisma', LEDGER);
      write(
        'prisma/sql/joined.sql',
        'SELECT 1 FROM auth.users u JOIN ledger.accounts a ON true',
      );
      write(
        'prisma/migrations/1_x/migration.sql',
        'ALTER TABLE "auth"."users" ADD CONSTRAINT "f" FOREIGN KEY ("a") REFERENCES "ledger"."accounts"("id");',
      );
      const messages = checkProject(root, {}).findings.map((f) => f.message);
      expect(messages).toHaveLength(3);
      expect(messages.join('\n')).toMatch(/User\.acct relates to Account/);
      expect(messages.join('\n')).toMatch(
        /JOIN across schemas "auth", "ledger"/,
      );
      expect(messages.join('\n')).toMatch(/references ledger\.accounts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
