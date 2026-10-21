import type { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { TotpService } from '../auth/totp/totp.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { WalletsService } from '../wallets/wallets.service.js';
import type { BeneficiariesService } from './beneficiaries.service.js';
import { WithdrawalsService } from './withdrawals.service.js';

const userId = '0199c1a0-0000-7000-8000-000000000001';
const walletId = '0199c1a0-0000-7000-8000-0000000000a1';
const beneficiaryId = '0199c1a0-0000-7000-8000-0000000000b1';

const dto = {
  walletId,
  beneficiaryId,
  amount: '10.00',
  currency: 'AED',
  totpCode: '123456',
};

describe('WithdrawalsService.payout', () => {
  let beneficiaries: { requireActive: ReturnType<typeof vi.fn> };
  let totp: { verify: ReturnType<typeof vi.fn> };
  let ledger: {
    ensureSystemAccount: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
  let wallets: { findOwned: ReturnType<typeof vi.fn> };
  let service: WithdrawalsService;

  beforeEach(() => {
    beneficiaries = {
      requireActive: vi.fn().mockResolvedValue({
        id: beneficiaryId,
        currency: 'AED',
      }),
    };
    totp = { verify: vi.fn() };
    ledger = {
      ensureSystemAccount: vi.fn().mockResolvedValue({ id: 'clearing' }),
      post: vi.fn().mockResolvedValue({}),
    };
    wallets = {
      findOwned: vi.fn().mockResolvedValue({
        id: walletId,
        currency: 'AED',
        status: 'active',
        ledgerAccountId: 'acc-1',
      }),
    };
    const idempotency = {
      runOnce: vi.fn(
        async (
          _scope: string,
          _key: string,
          _request: unknown,
          work: (tx: object) => Promise<unknown>,
        ) => ({
          statusCode: 201,
          body: await work({}),
          replayed: false,
        }),
      ),
    };
    service = new WithdrawalsService(
      beneficiaries as unknown as BeneficiariesService,
      totp as unknown as TotpService,
      idempotency as unknown as IdempotencyService,
      ledger as unknown as LedgerService,
      wallets as unknown as WalletsService,
    );
  });

  it('posts a ledger entry after a fresh code', async () => {
    totp.verify.mockResolvedValue(true);
    const result = await service.payout(userId, 'key-1', dto);
    expect(result.body.status).toBe('COMPLETED');
    expect(result.body.amount).toBe('10.00');
    expect(totp.verify).toHaveBeenCalledWith(userId, '123456');
    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          { accountId: 'acc-1', amount: '-10.00' },
          { accountId: 'clearing', amount: '10.00' },
        ],
      }),
      expect.anything(),
    );
  });

  it('does not post when the code is wrong, including a replay of a used code', async () => {
    totp.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await service.payout(userId, 'key-1', dto);
    await expect(
      service.payout(userId, 'key-2', { ...dto, totpCode: '123456' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOTP', statusCode: 422 });
    expect(ledger.post).toHaveBeenCalledTimes(1);
  });
});
