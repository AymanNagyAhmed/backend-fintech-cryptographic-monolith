import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import pg from 'pg';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  auditLeafDigest,
  merkleHashToHex,
  merkleRoot,
} from '../src/common/crypto/merkle.js';
import {
  GENESIS_PREV_HASH,
  chainHash,
} from '../src/modules/audit/chain-hash.js';
import { VerifyService } from '../src/modules/audit/verify.service.js';
import { CheckpointerService } from '../src/modules/checkpoints/checkpointer.service.js';
import {
  sthCanonicalBytes,
  sthContentHash,
  type SthPayload,
} from '../src/modules/checkpoints/sth-payload.js';
import type { TsaService } from '../src/modules/checkpoints/tsa.service.js';
import { WitnessService } from '../src/modules/checkpoints/witness.service.js';
import type { WormService } from '../src/modules/checkpoints/worm.service.js';
import { LocalTestSigner } from '../src/modules/crypto/adapters/local-test.signer.js';
import { encodePublicKey } from '../src/modules/crypto/public-key.js';
import { SignerService } from '../src/modules/crypto/signer.service.js';
import { SigningKeysService } from '../src/modules/crypto/signing-keys.service.js';
import {
  dockerAvailable,
  migrate,
  startPostgres,
} from './support/containers.js';
import type { ContainerPostgres } from './support/containers.js';

/** Test signer that can hand out its public key for publishing. */
class PublishableSigner extends LocalTestSigner {
  publicKeyOf(keyRef: string, version: number): Promise<KeyObject | null> {
    return this.loadPublicKey(keyRef, version);
  }
}

const KEY_REF = 'audit-signing';
const PARTITION = '0';

const config = (value: string) =>
  ({ get: () => value }) as unknown as ConfigService<never, true>;

/**
 * A-B15.3 tamper suite (2.1, 2.3, 2.6): a superuser edits the database behind the
 * application and the verifier, witness or signature check must catch each attack.
 * Runs on a disposable Postgres (Testcontainers), so the append-only triggers can be
 * switched off without touching the dev database.
 */
describe.skipIf(!dockerAvailable())('Audit tamper suite', () => {
  let db: ContainerPostgres;
  let prisma: PrismaService;
  let admin: pg.Client;
  let honest: PublishableSigner;
  let signer: SignerService;
  let checkpointer: CheckpointerService;
  let verify: VerifyService;
  let witness: WitnessService;

  beforeAll(async () => {
    db = await startPostgres();
    migrate(db.migratorUrl);
    prisma = new PrismaService(config(db.appUrl));
    admin = new pg.Client({ connectionString: db.migratorUrl });
    await admin.connect();

    honest = new PublishableSigner('ed25519', 'test');
    const keys = new SigningKeysService(prisma);
    signer = new SignerService(honest, keys, config('ed25519'));
    await signer.sign(new Uint8Array([1]), KEY_REF); // creates v1
    const publicKey = await honest.publicKeyOf(KEY_REF, 1);
    await keys.activate({
      keyId: `${KEY_REF}:v1`,
      alg: 'ed25519',
      publicKey: encodePublicKey(publicKey!),
    });

    const tsa = {
      stampTreeHead: async () => undefined,
    } as unknown as TsaService;
    const worm = { putBatch: async () => ({}) } as unknown as WormService;
    const clock = {
      sample: async () => ({
        offsetSeconds: 0,
        quality: 'ok' as const,
        outOfTolerance: false,
        source: 'stub' as const,
      }),
    };
    checkpointer = new CheckpointerService(
      prisma,
      signer,
      tsa,
      worm,
      clock as never,
      config(KEY_REF) as never,
    );
    verify = new VerifyService(prisma);
  }, 240_000);

  afterAll(async () => {
    await admin?.end();
    await prisma?.$disconnect();
    await db?.container.stop();
  }, 60_000);

  /** Runs `sql` as the schema owner with the append-only triggers off. */
  const asSuperuser = async (sql: string, params: unknown[] = []) => {
    await admin.query('ALTER TABLE audit.audit_events DISABLE TRIGGER USER');
    await admin.query('ALTER TABLE audit.tree_heads DISABLE TRIGGER USER');
    try {
      return await admin.query(sql, params);
    } finally {
      await admin.query('ALTER TABLE audit.audit_events ENABLE TRIGGER USER');
      await admin.query('ALTER TABLE audit.tree_heads ENABLE TRIGGER USER');
    }
  };

  const signatureOk = (head: {
    treeSize: number;
    rootHash: string;
    timestamp: Date;
    previousSthHash: string | null;
    alg: string;
    keyId: string;
    signature: string;
  }) =>
    signer.verify(
      sthCanonicalBytes({
        treeSize: head.treeSize,
        rootHash: head.rootHash,
        timestamp: head.timestamp.toISOString(),
        previousSthHash: head.previousSthHash,
      }),
      { alg: head.alg as 'ed25519', keyId: head.keyId, sig: head.signature },
    );

  const append = async (from: number, to: number) => {
    for (let i = from; i <= to; i++) {
      const tip = await prisma.auditEvent.findFirst({
        where: { partitionKey: PARTITION },
        orderBy: { seq: 'desc' },
        select: { hash: true },
      });
      const prev = tip?.hash ?? GENESIS_PREV_HASH;
      const payload = {
        type: 'transfer.completed',
        schemaVersion: 1,
        amount: `${i}.00`,
      };
      await prisma.auditEvent.create({
        data: {
          partitionKey: PARTITION,
          seq: BigInt(i),
          payload,
          prevHash: prev,
          hash: chainHash(prev, payload),
          sourceContext: 'ledger',
          sourceId: randomUUID(),
          occurredAt: new Date(),
        },
      });
    }
  };

  /** Six events and two signed tree heads (sizes 3 and 6). */
  beforeEach(async () => {
    await asSuperuser(
      'TRUNCATE audit.audit_events, audit.tree_heads RESTART IDENTITY CASCADE',
    );
    witness = new WitnessService(prisma);
    await append(1, 3);
    expect((await checkpointer.build()).treeSize).toBe(3);
    await append(4, 6);
    expect((await checkpointer.build()).treeSize).toBe(6);
  });

  it('baseline: untouched data passes the verifier and the witness', async () => {
    expect(await verify.verify(PARTITION)).toMatchObject({
      ok: true,
      eventsChecked: 6,
      brokenAt: null,
    });
    expect(await witness.check()).toMatchObject({ ok: true, checkedPairs: 1 });
    for (const head of await prisma.treeHead.findMany()) {
      expect(await signatureOk(head)).toBe(true);
    }
  });

  it('the application role cannot edit or delete audit rows', async () => {
    await expect(
      prisma.$executeRaw`UPDATE audit.audit_events SET payload = '{}'::jsonb`,
    ).rejects.toThrow(/permission denied|append-only/i);
    await expect(
      prisma.$executeRaw`DELETE FROM audit.audit_events`,
    ).rejects.toThrow(/permission denied|append-only/i);
    await expect(
      prisma.$executeRaw`UPDATE audit.tree_heads SET root_hash = repeat('0', 64)`,
    ).rejects.toThrow(/permission denied|append-only/i);
  });

  it('edit a row: the verifier names the exact row', async () => {
    await asSuperuser(
      `UPDATE audit.audit_events
       SET payload = jsonb_set(payload, '{amount}', '"9999.00"')
       WHERE partition_key = $1 AND seq = 3`,
      [PARTITION],
    );
    const report = await verify.verify(PARTITION);
    expect(report.ok).toBe(false);
    expect(report.brokenAt).toEqual({ partition: PARTITION, seq: '3' });
  });

  it('edit a row and recompute its hash: the next row breaks and the witness sees a new root', async () => {
    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { partitionKey: PARTITION, seq: 3n },
    });
    const forged = { ...(row.payload as object), amount: '9999.00' };
    await asSuperuser(
      `UPDATE audit.audit_events SET payload = $2::jsonb, hash = $3
       WHERE partition_key = $1 AND seq = 3`,
      [PARTITION, JSON.stringify(forged), chainHash(row.prevHash, forged)],
    );
    expect((await verify.verify(PARTITION)).brokenAt).toEqual({
      partition: PARTITION,
      seq: '4',
    });
    const report = await witness.check();
    expect(report.ok).toBe(false);
    expect(report.forkAt?.reason).toBe('recomputed root mismatch');
  });

  it('delete the tail: the chain still verifies, the witness reports missing leaves', async () => {
    await asSuperuser(
      `DELETE FROM audit.audit_events WHERE partition_key = $1 AND seq > 4`,
      [PARTITION],
    );
    // A shortened chain is internally consistent: only the signed tree head exposes it
    expect((await verify.verify(PARTITION)).ok).toBe(true);
    const report = await witness.check();
    expect(report.ok).toBe(false);
    expect(report.forkAt?.reason).toBe('only 4 leaves for treeSize=6');
  });

  it('delete a middle row: the verifier reports the gap and the broken link', async () => {
    await asSuperuser(
      `DELETE FROM audit.audit_events WHERE partition_key = $1 AND seq = 3`,
      [PARTITION],
    );
    const report = await verify.verify(PARTITION);
    expect(report.ok).toBe(false);
    expect(report.gaps).toEqual([{ partition: PARTITION, seq: '3' }]);
    expect(report.brokenAt).toEqual({ partition: PARTITION, seq: '4' });
  });

  it('reorder chain positions: the verifier reports the first moved row', async () => {
    // swap seq 2 and 3 through a temporary value (unique (partition_key, seq))
    await asSuperuser(
      `UPDATE audit.audit_events SET seq = 1000 WHERE partition_key = '${PARTITION}' AND seq = 2;
       UPDATE audit.audit_events SET seq = 2 WHERE partition_key = '${PARTITION}' AND seq = 3;
       UPDATE audit.audit_events SET seq = 3 WHERE partition_key = '${PARTITION}' AND seq = 1000;`,
    );
    const report = await verify.verify(PARTITION);
    expect(report.ok).toBe(false);
    expect(report.brokenAt).toEqual({ partition: PARTITION, seq: '2' });
  });

  it('reorder leaves in the log: the witness sees a different Merkle root', async () => {
    await asSuperuser(
      `UPDATE audit.audit_events a SET created_at = b.created_at
       FROM (SELECT seq, created_at FROM audit.audit_events WHERE partition_key = $1) b
       WHERE a.partition_key = $1 AND a.seq = CASE b.seq WHEN 4 THEN 5 WHEN 5 THEN 4 END`,
      [PARTITION],
    );
    // the hash chain itself is untouched ...
    expect((await verify.verify(PARTITION)).ok).toBe(true);
    // ... but the tree head of size 6 no longer matches the leaf order
    const report = await witness.check();
    expect(report.ok).toBe(false);
    expect(report.forkAt).toMatchObject({
      to: 6,
      reason: 'recomputed root mismatch',
    });
  });

  it('replace a leaf, rebuild the chain and re-sign with a wrong key: the signature check rejects it', async () => {
    // Attacker rewrites seq 3 and recomputes every later hash, then forges a matching tree head
    const rows = await prisma.auditEvent.findMany({
      where: { partitionKey: PARTITION },
      orderBy: { seq: 'asc' },
    });
    let prev = rows[1]!.hash;
    const rebuilt: {
      seq: bigint;
      payload: object;
      prev: string;
      hash: string;
    }[] = [];
    for (const row of rows.slice(2)) {
      const payload =
        row.seq === 3n
          ? { ...(row.payload as object), amount: '9999.00' }
          : (row.payload as object);
      const hash = chainHash(prev, payload);
      rebuilt.push({ seq: row.seq, payload, prev, hash });
      prev = hash;
    }
    for (const r of rebuilt) {
      await asSuperuser(
        `UPDATE audit.audit_events SET payload = $3::jsonb, prev_hash = $4, hash = $5
         WHERE partition_key = $1 AND seq = $2`,
        [PARTITION, r.seq, JSON.stringify(r.payload), r.prev, r.hash],
      );
    }
    const all = await prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { hash: true },
    });
    const forgedRoot = merkleHashToHex(
      merkleRoot(
        all.map((l) => auditLeafDigest(l.hash)),
        true,
      ),
    );
    const heads = await prisma.treeHead.findMany({
      orderBy: { treeSize: 'asc' },
    });
    const honestHead = heads[1]!;
    const forgedPayload: SthPayload = {
      treeSize: 6,
      rootHash: forgedRoot,
      timestamp: honestHead.timestamp.toISOString(),
      previousSthHash: honestHead.previousSthHash,
    };
    // attacker's own key, labelled with the published key id
    const attacker = new PublishableSigner('ed25519', 'test');
    const forgedSig = await attacker.sign(
      sthCanonicalBytes(forgedPayload),
      KEY_REF,
    );
    await asSuperuser(
      `UPDATE audit.tree_heads SET root_hash = $1, signature = $2 WHERE tree_size = 6`,
      [forgedRoot, forgedSig.sig],
    );

    // The rewritten chain is self-consistent and the replaced head matches it ...
    expect((await verify.verify(PARTITION)).ok).toBe(true);
    expect(await witness.check()).toMatchObject({ ok: true });

    // ... only the signature against the published key gives it away.
    const stored = (await prisma.treeHead.findUnique({
      where: { treeSize: 6 },
    }))!;
    const storedPayload: SthPayload = {
      treeSize: stored.treeSize,
      rootHash: stored.rootHash,
      timestamp: stored.timestamp.toISOString(),
      previousSthHash: stored.previousSthHash,
    };
    expect(
      await signer.verify(sthCanonicalBytes(storedPayload), {
        alg: 'ed25519',
        keyId: stored.keyId,
        sig: stored.signature,
      }),
    ).toBe(false);

    // The honest head (size 3, untouched) still verifies against the same key
    const first = heads[0]!;
    expect(
      await signer.verify(
        sthCanonicalBytes({
          treeSize: first.treeSize,
          rootHash: first.rootHash,
          timestamp: first.timestamp.toISOString(),
          previousSthHash: first.previousSthHash,
        }),
        { alg: 'ed25519', keyId: first.keyId, sig: first.signature },
      ),
    ).toBe(true);
    expect(sthContentHash(forgedPayload)).not.toBe(
      sthContentHash({
        treeSize: honestHead.treeSize,
        rootHash: honestHead.rootHash,
        timestamp: honestHead.timestamp.toISOString(),
        previousSthHash: honestHead.previousSthHash,
      }),
    );
  });
});
