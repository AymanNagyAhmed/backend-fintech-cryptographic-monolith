import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { CURRENCIES } from '../src/common/money/currency.js';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { WalletsModule } from '../src/modules/wallets/wallets.module.js';
import { WalletsService } from '../src/modules/wallets/wallets.service.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateWallets migration applied.
// app_writer cannot DELETE, so every run uses fresh owner ids and leaves its rows behind.
describe('WalletsService (database)', () => {
  let prisma: PrismaService;
  let wallets: WalletsService;
  const newWallet = (currency = 'AED', ownerUserId = randomUUID()) => ({
    ownerUserId,
    currency,
    ledgerAccountId: randomUUID(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        WalletsModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    wallets = moduleRef.get(WalletsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an active wallet with a UUID v7 id', async () => {
    const input = newWallet('BTC');
    const wallet = await wallets.create(input);
    expect(wallet.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(wallet).toMatchObject({ ...input, status: 'active' });
    await expect(wallets.findById(wallet.id)).resolves.toEqual(wallet);
  });

  it('allows several wallets per owner in one currency', async () => {
    const owner = randomUUID();
    await wallets.create(newWallet('AED', owner));
    await wallets.create(newWallet('AED', owner));
    await wallets.create(newWallet('USD', owner));
    const list = await wallets.listByOwner(owner);
    expect(list.map((w) => w.currency).sort()).toEqual(['AED', 'AED', 'USD']);
    expect(list.map((w) => w.id)).toEqual(list.map((w) => w.id).sort());
  });

  it('a ledger account backs at most one wallet', async () => {
    const first = await wallets.create(newWallet());
    await expect(
      wallets.create({
        ...newWallet(),
        ledgerAccountId: first.ledgerAccountId,
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('findOwned hides other users wallets', async () => {
    const wallet = await wallets.create(newWallet());
    await expect(
      wallets.findOwned(wallet.id, wallet.ownerUserId),
    ).resolves.toMatchObject({ id: wallet.id });
    await expect(
      wallets.findOwned(wallet.id, randomUUID()),
    ).resolves.toBeNull();
  });

  it('the currency CHECK lists exactly CURRENCY_SCALE', async () => {
    const [{ def }] = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'wallets_currency_chk'`;
    const listed = [...def.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...CURRENCIES].sort());
  });

  it('the database rejects an unsupported currency', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO wallet.wallets (owner_user_id, currency, ledger_account_id, updated_at)
        VALUES (${randomUUID()}::uuid, 'GBP', ${randomUUID()}::uuid, now())`,
    ).rejects.toThrow(/wallets_currency_chk/);
  });

  it.each([
    ['owner_user_id', `owner_user_id = uuidv7()`],
    ['currency', `currency = 'USD'`],
    ['ledger_account_id', `ledger_account_id = uuidv7()`],
    ['created_at', `created_at = now() - interval '1 day'`],
  ])('the trigger keeps %s fixed', async (_, set) => {
    const { id } = await wallets.create(newWallet());
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE wallet.wallets SET ${set} WHERE id = $1::uuid`,
        id,
      ),
    ).rejects.toThrow(/wallets: owner, currency and ledger account are fixed/);
  });

  it('status can move between active and frozen, and closed is final', async () => {
    const { id } = await wallets.create(newWallet());
    const setStatus = (status: string) =>
      prisma.$executeRaw`
        UPDATE wallet.wallets SET status = ${status}::wallet.wallet_status, updated_at = now()
        WHERE id = ${id}::uuid`;
    await expect(setStatus('frozen')).resolves.toBe(1);
    await expect(setStatus('active')).resolves.toBe(1);
    await expect(setStatus('closed')).resolves.toBe(1);
    await expect(setStatus('active')).rejects.toThrow(
      /closed wallet stays closed/,
    );
  });

  describe('label', () => {
    const setLabel = (id: string, label: string) =>
      prisma.$executeRaw`UPDATE wallet.wallets SET label = ${label} WHERE id = ${id}::uuid`;

    it('is optional, trimmed on create and not unique per owner', async () => {
      const owner = randomUUID();
      const plain = await wallets.create(newWallet('AED', owner));
      const a = await wallets.create({
        ...newWallet('AED', owner),
        label: ' Savings ',
      });
      const b = await wallets.create({
        ...newWallet('AED', owner),
        label: 'Savings',
      });
      expect([plain.label, a.label, b.label]).toEqual([
        null,
        'Savings',
        'Savings',
      ]);
    });

    it('rename sets and clears the label of an owned wallet', async () => {
      const w = await wallets.create(newWallet());
      await expect(
        wallets.rename(w.id, w.ownerUserId, 'Travel ✈'),
      ).resolves.toMatchObject({ id: w.id, label: 'Travel ✈' });
      await expect(
        wallets.rename(w.id, w.ownerUserId, null),
      ).resolves.toMatchObject({ label: null });
    });

    it("rename answers WALLET_NOT_FOUND for another user's or a missing wallet", async () => {
      const w = await wallets.create({ ...newWallet(), label: 'Mine' });
      await expect(
        wallets.rename(w.id, randomUUID(), 'Stolen'),
      ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND', statusCode: 404 });
      await expect(
        wallets.rename(randomUUID(), w.ownerUserId, 'x'),
      ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
      await expect(wallets.findById(w.id)).resolves.toMatchObject({
        label: 'Mine',
      });
    });

    it('a frozen wallet can be renamed, a closed one cannot', async () => {
      const w = await wallets.create({ ...newWallet(), label: 'Old' });
      const setStatus = (status: string) =>
        prisma.$executeRaw`
          UPDATE wallet.wallets SET status = ${status}::wallet.wallet_status WHERE id = ${w.id}::uuid`;
      await setStatus('frozen');
      await expect(
        wallets.rename(w.id, w.ownerUserId, 'Frozen'),
      ).resolves.toMatchObject({ label: 'Frozen' });
      await setStatus('closed');
      await expect(
        wallets.rename(w.id, w.ownerUserId, 'New'),
      ).rejects.toMatchObject({ code: 'WALLET_CLOSED', statusCode: 409 });
      await expect(setLabel(w.id, 'Raw')).rejects.toThrow(
        /closed wallet cannot be renamed/,
      );
      await expect(
        prisma.$executeRaw`UPDATE wallet.wallets SET label = NULL WHERE id = ${w.id}::uuid`,
      ).rejects.toThrow(/closed wallet cannot be renamed/);
      await expect(wallets.findById(w.id)).resolves.toMatchObject({
        label: 'Frozen',
      });
    });

    it.each([
      ['empty', ''],
      ['leading space', ' x'],
      ['trailing tab', 'x\t'],
      ['trailing no-break space', 'x\u00A0'],
      ['newline', 'a\nb'],
      ['DEL', 'a\u007Fb'],
      ['C1 control', 'a\u0085b'],
    ])('the CHECK rejects a label with %s', async (_, label) => {
      const { id } = await wallets.create(newWallet());
      await expect(setLabel(id, label)).rejects.toThrow(/wallets_label_chk/);
    });

    it('the CHECK rejects every trailing character String.prototype.trim removes', async () => {
      const trimmed = Array.from({ length: 0x10000 }, (_, i) =>
        String.fromCharCode(i),
      ).filter((c) => c !== '\u0000' && `x${c}`.trim() === 'x');
      expect(trimmed.length).toBeGreaterThan(20);
      const { id } = await wallets.create(newWallet());
      for (const c of trimmed)
        await expect(setLabel(id, `x${c}`)).rejects.toThrow(
          /wallets_label_chk/,
        );
    });

    it('the CHECK accepts 50 characters, including non-ASCII, and VARCHAR(50) stops 51', async () => {
      const { id } = await wallets.create(newWallet());
      await expect(setLabel(id, 'ü'.repeat(50))).resolves.toBe(1);
      await expect(setLabel(id, 'a b')).resolves.toBe(1);
      await expect(setLabel(id, 'a'.repeat(51))).rejects.toThrow(
        /too long|22001/,
      );
    });
  });

  it('app_writer cannot delete wallets', async () => {
    const { id } = await wallets.create(newWallet());
    await expect(
      prisma.$executeRaw`DELETE FROM wallet.wallets WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/permission denied/);
  });
});
