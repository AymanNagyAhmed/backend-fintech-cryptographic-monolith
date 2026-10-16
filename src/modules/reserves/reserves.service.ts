import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { WalletsService } from '../wallets/wallets.service.js';
import {
  reservesLeafNotFound,
  reservesNoLiabilities,
  reservesSnapshotExists,
  reservesSnapshotNotFound,
} from './exceptions/reserves.exceptions.js';
import {
  buildMerkleSumTree,
  sumInclusionProof,
  type MerkleSumLeaf,
} from './merkle-sum.js';
import { merkleHashToHex } from '../checkpoints/merkle.js';

const UNIQUE_VIOLATION = 'P2002';
/** Keeps one INSERT well below the PostgreSQL bind parameter limit. */
const LEAF_INSERT_CHUNK = 1000;
const SALT_BYTES = 16;

export interface ReservesSnapshotView {
  id: string;
  currency: Currency;
  /** UTC day the snapshot covers, YYYY-MM-DD. */
  snapshotDate: string;
  treeSize: number;
  rootHash: string;
  /** Currency-scale decimal string: the sum committed in the tree root. */
  totalLiabilities: string;
  publishedAt: string;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export interface ReservesProofView {
  snapshotId: string;
  currency: Currency;
  snapshotDate: string;
  treeSize: number;
  rootHash: string;
  totalLiabilities: string;
  leafIndex: number;
  balance: string;
  salt: string;
  /** Sibling nodes from leaf toward root: { hash hex, sum }. */
  path: { hash: string; sum: string }[];
}

@Injectable()
export class ReservesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  /**
   * Inclusion proof for the caller's leaf in the latest published snapshot (A-B13.6).
   * Returns leaf, salt and Merkle-sum path so the client can verify against the published root.
   */
  async proofForUser(
    userId: string,
    currency: string,
  ): Promise<ReservesProofView> {
    if (!isCurrency(currency)) throw new UnsupportedCurrencyException(currency);
    const snapshot = await this.prisma.reservesSnapshot.findFirst({
      where: { currency },
      orderBy: { snapshotDate: 'desc' },
    });
    if (!snapshot) throw reservesSnapshotNotFound(currency);

    const leafRows = await this.prisma.reservesLeaf.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { leafIndex: 'asc' },
    });
    const mine = leafRows.find((r) => r.userId === userId);
    if (!mine) throw reservesLeafNotFound();

    const leaves: MerkleSumLeaf[] = leafRows.map((r) => ({
      userId: r.userId,
      balance: r.balance.toFixed(),
      salt: r.salt,
    }));
    const tree = buildMerkleSumTree(currency, leaves);
    const path = sumInclusionProof(tree, mine.leafIndex).map((step) => ({
      hash: merkleHashToHex(step.hash),
      sum: step.sum,
    }));

    return {
      snapshotId: snapshot.id,
      currency,
      snapshotDate: utcDay(snapshot.snapshotDate),
      treeSize: snapshot.treeSize,
      rootHash: snapshot.rootHash,
      totalLiabilities: snapshot.totalLiabilities.toFixed(),
      leafIndex: mine.leafIndex,
      balance: mine.balance.toFixed(),
      salt: mine.salt,
      path,
    };
  }

  /**
   * Publishes the proof-of-reserves commitment for `currency` and the UTC day of `now`
   * (A-B13.5, 2.14): one leaf per client with a positive balance (summed over their wallets,
   * ordered by user id), a Merkle-sum tree over them, and the root plus total liabilities.
   * Snapshot and leaves (with their salts, for later inclusion proofs) commit together; a
   * second snapshot for the same currency and day answers RESERVES_SNAPSHOT_EXISTS (409).
   * Balances come from WalletsService; this module never reads another context's tables.
   */
  async buildDailySnapshot(
    currency: string,
    now: Date = new Date(),
  ): Promise<ReservesSnapshotView> {
    if (!isCurrency(currency)) throw new UnsupportedCurrencyException(currency);
    const day = utcDay(now);
    const snapshotDate = new Date(`${day}T00:00:00.000Z`);

    // Cheap early exit before scanning every wallet; the unique index below is the real guard
    const existing = await this.prisma.reservesSnapshot.findUnique({
      where: { currency_snapshotDate: { currency, snapshotDate } },
      select: { id: true },
    });
    if (existing) throw reservesSnapshotExists(currency, day);

    const balances = await this.wallets.sumBalancesByOwner(currency);
    const leaves: MerkleSumLeaf[] = [...balances.entries()]
      .filter(([, balance]) => balance.isPositive())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([userId, balance]) => ({
        userId,
        balance: balance.toString(),
        salt: randomBytes(SALT_BYTES).toString('hex'),
      }));
    if (leaves.length === 0) throw reservesNoLiabilities(currency);

    const tree = buildMerkleSumTree(currency, leaves);
    const rootHash = merkleHashToHex(tree.root.hash);

    try {
      const row = await this.prisma.withTx(async (tx) => {
        const snapshot = await tx.reservesSnapshot.create({
          data: {
            currency,
            snapshotDate,
            treeSize: tree.size,
            rootHash,
            totalLiabilities: tree.root.sum,
          },
        });
        for (let i = 0; i < leaves.length; i += LEAF_INSERT_CHUNK) {
          await tx.reservesLeaf.createMany({
            data: leaves.slice(i, i + LEAF_INSERT_CHUNK).map((leaf, j) => ({
              snapshotId: snapshot.id,
              leafIndex: i + j,
              userId: leaf.userId,
              balance: leaf.balance,
              salt: leaf.salt,
              leafHash: merkleHashToHex(tree.leaves[i + j]!.hash),
            })),
          });
        }
        return snapshot;
      });
      return {
        id: row.id,
        currency,
        snapshotDate: day,
        treeSize: row.treeSize,
        rootHash: row.rootHash,
        totalLiabilities: tree.root.sum,
        publishedAt: row.publishedAt.toISOString(),
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === UNIQUE_VIOLATION
      )
        throw reservesSnapshotExists(currency, day);
      throw e;
    }
  }
}
