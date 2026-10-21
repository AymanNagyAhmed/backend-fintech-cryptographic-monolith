import type { DomainException } from '../../common/exceptions/domain.exception.js';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccountNotActiveException } from '../ledger/exceptions/account-not-active.exception.js';
import { postingExists } from '../ledger/exceptions/ledger.exceptions.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { WalletView, WalletsService } from '../wallets/wallets.service.js';
import { PaymentsService } from './payments.service.js';
import {
  ProviderEventUnavailable,
  type ProviderEvents,
  type ProviderPayment,
} from './provider-events.js';
import type { WebhookEventsService } from './webhook-events.service.js';

const WALLET_ID = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70';
const event = {
  id: 'evt_3PqR8s2eZvKYlo2C',
  type: 'payment.succeeded',
  data: { walletId: WALLET_ID, amount: '250', currency: 'AED' },
};
const wallet = {
  id: WALLET_ID,
  currency: 'AED',
  status: 'active',
  ledgerAccountId: 'acc-wallet',
} as unknown as WalletView;

const savepoints: string[] = [];
const tx = {
  $executeRaw: vi.fn((sql: TemplateStringsArray) => {
    savepoints.push(sql.join(''));
    return Promise.resolve(0);
  }),
} as unknown as Prisma.TransactionClient;

const runOnce = vi.fn(
  async (
    _scope: string,
    _key: string,
    _request: unknown,
    work: (t: Prisma.TransactionClient) => Promise<unknown>,
  ) => ({ statusCode: 200, body: await work(tx), replayed: false }),
);
const findById = vi.fn();
const ensureSystemAccount = vi.fn();
const post = vi.fn();
const find = vi.fn();
const record = vi.fn();
const load = vi.fn(
  async (provider: 'stripe', eventId: string): Promise<ProviderPayment> => ({
    provider,
    eventId,
    amount: event.data.amount,
    currency: event.data.currency,
    destination: event.data.walletId,
  }),
);

const service = new PaymentsService(
  { runOnce } as unknown as IdempotencyService,
  { ensureSystemAccount, post } as unknown as LedgerService,
  { findById } as unknown as WalletsService,
  { find, record } as unknown as WebhookEventsService,
  { load } as unknown as ProviderEvents,
);
const TIMESTAMP = '1760464800';
const receive = (body: unknown) => service.receive('stripe', body, TIMESTAMP);

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    const err = e as DomainException;
    return { status: err.statusCode, code: err.code, details: err.details };
  }
  throw new Error('expected a DomainException');
};

describe('PaymentsService', () => {
  beforeEach(() => {
    savepoints.length = 0;
    vi.clearAllMocks();
    findById.mockResolvedValue(wallet);
    ensureSystemAccount.mockResolvedValue({ id: 'acc-clearing' });
    post.mockResolvedValue({});
    find.mockResolvedValue(null);
    record.mockResolvedValue(undefined);
  });

  describe('webhook_events', () => {
    const body = { ...event, object: 'event', created: 1760464800 };

    it('records the event once with its outcome, signature time and redacted payload', async () => {
      await receive({
        ...body,
        data: { ...event.data, customer: { email: 'a@b.c' } },
        livemode: false,
      });
      expect(find).toHaveBeenCalledWith(tx, 'stripe', event.id);
      expect(record).toHaveBeenCalledWith(tx, {
        provider: 'stripe',
        eventId: event.id,
        type: 'payment.succeeded',
        outcome: 'credited',
        reason: undefined,
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        payload: {
          id: event.id,
          type: 'payment.succeeded',
          created: 1760464800,
          data: event.data,
        },
        signedAt: new Date('2025-10-14T18:00:00Z'),
      });
    });

    it('records a rejection with its reason', async () => {
      findById.mockResolvedValue(null);
      await receive(event);
      expect(record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          outcome: 'rejected',
          reason: {
            code: 'WALLET_NOT_FOUND',
            message: 'No wallet with this id exists.',
          },
        }),
      );
    });

    it('records an ignored event without data', async () => {
      await receive({ id: 'evt_2', type: 'payment.refunded', data: { a: 1 } });
      expect(record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          outcome: 'ignored',
          payload: { id: 'evt_2', type: 'payment.refunded' },
        }),
      );
    });

    it('answers from the stored row after the idempotency key was purged, without processing', async () => {
      await receive(body);
      const { requestHash } = record.mock.calls[0][1] as {
        requestHash: string;
      };
      vi.clearAllMocks();
      find.mockResolvedValue({
        outcome: 'rejected',
        reason: { code: 'ACCOUNT_FROZEN', message: 'The wallet is frozen.' },
        requestHash,
      });
      const res = await receive(body);
      expect(res.body).toEqual({
        provider: 'stripe',
        eventId: event.id,
        type: 'payment.succeeded',
        status: 'rejected',
        deposit: { walletId: WALLET_ID, amount: '250.00', currency: 'AED' },
        reason: { code: 'ACCOUNT_FROZEN', message: 'The wallet is frozen.' },
      });
      expect(findById).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    });

    it('answers 422 IDEMPOTENCY_KEY_REUSED when the stored row has another body', async () => {
      find.mockResolvedValue({
        outcome: 'credited',
        requestHash: 'f'.repeat(64),
      });
      await expect(receive(event)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        statusCode: 422,
      });
      expect(post).not.toHaveBeenCalled();
    });
  });

  it('credits the wallet against the provider clearing account, once per event id', async () => {
    const res = await receive(event);
    expect(runOnce).toHaveBeenCalledWith(
      'webhook:stripe',
      'evt_3PqR8s2eZvKYlo2C',
      event,
      expect.any(Function),
    );
    expect(ensureSystemAccount).toHaveBeenCalledWith(
      { code: 'clearing:stripe:aed', currency: 'AED', allowNegative: true },
      tx,
    );
    expect(load).toHaveBeenCalledWith('stripe', event.id);
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      post.mock.invocationCallOrder[0],
    );
    expect(post).toHaveBeenCalledWith(
      {
        ref: 'webhook:stripe:evt_3PqR8s2eZvKYlo2C',
        entries: [
          { accountId: 'acc-clearing', amount: '-250.00' },
          { accountId: 'acc-wallet', amount: '250.00' },
        ],
      },
      tx,
    );
    expect(res.body).toEqual({
      provider: 'stripe',
      eventId: 'evt_3PqR8s2eZvKYlo2C',
      type: 'payment.succeeded',
      status: 'credited',
      deposit: { walletId: WALLET_ID, amount: '250.00', currency: 'AED' },
    });
  });

  it('ignores other event types without touching wallets or the ledger', async () => {
    const res = await receive({
      id: 'evt_2',
      type: 'payment.refunded',
      data: { anything: true },
    });
    expect(res.body).toEqual({
      provider: 'stripe',
      eventId: 'evt_2',
      type: 'payment.refunded',
      status: 'ignored',
    });
    expect(findById).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ['WALLET_NOT_FOUND', null],
    ['CURRENCY_MISMATCH', { ...wallet, currency: 'USD' }],
    ['ACCOUNT_FROZEN', { ...wallet, status: 'frozen' }],
    ['ACCOUNT_CLOSED', { ...wallet, status: 'closed' }],
  ])('stores a rejection %s without posting', async (code, found) => {
    findById.mockResolvedValue(found);
    const res = await receive(event);
    expect(res.body).toMatchObject({
      status: 'rejected',
      deposit: { walletId: WALLET_ID, amount: '250.00', currency: 'AED' },
      reason: { code },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('rolls back to the savepoint when the ledger finds the wallet account frozen', async () => {
    post.mockRejectedValue(
      new AccountNotActiveException('acc-wallet', 'frozen'),
    );
    const res = await receive(event);
    expect(res.body).toMatchObject({
      status: 'rejected',
      reason: { code: 'ACCOUNT_FROZEN' },
    });
    expect(savepoints).toEqual([
      'SAVEPOINT webhook_deposit',
      'ROLLBACK TO SAVEPOINT webhook_deposit',
    ]);
  });

  it('answers 503 when the clearing account is not active, so the provider retries', async () => {
    post.mockRejectedValue(
      new AccountNotActiveException('acc-clearing', 'frozen'),
    );
    await expect(receive(event)).rejects.toMatchObject({
      code: 'DEPOSITS_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('answers credited when the posting already exists (key purged after 30 days)', async () => {
    post.mockRejectedValue(
      postingExists('webhook:stripe:evt_3PqR8s2eZvKYlo2C'),
    );
    const res = await receive(event);
    expect(res.body).toMatchObject({ status: 'credited' });
    expect(savepoints).toContain('ROLLBACK TO SAVEPOINT webhook_deposit');
  });

  it('does not credit when the provider record shows a different amount', async () => {
    load.mockResolvedValueOnce({
      provider: 'stripe',
      eventId: event.id,
      amount: '1.00',
      currency: 'AED',
      destination: WALLET_ID,
    });
    const res = await receive(event);
    expect(res.body).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'PROVIDER_MISMATCH',
        message: 'The provider record does not match the signed callback.',
      },
    });
    expect(post).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ outcome: 'rejected' }),
    );
    const { requestHash } = record.mock.calls[0][1] as { requestHash: string };
    vi.clearAllMocks();
    find.mockResolvedValue({
      outcome: 'rejected',
      reason: res.body.reason,
      requestHash,
    });
    const again = await receive(event);
    expect(again.body).toMatchObject({ status: 'rejected' });
    expect(load).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('stores a failed provider fetch as rejected and does not post', async () => {
    load.mockRejectedValueOnce(new ProviderEventUnavailable());
    const res = await receive(event);
    expect(res.body).toMatchObject({
      status: 'rejected',
      reason: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(post).not.toHaveBeenCalled();
    expect(ensureSystemAccount).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        outcome: 'rejected',
        reason: expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      }),
    );
    expect(runOnce).toHaveBeenCalledWith(
      'webhook:stripe',
      event.id,
      event,
      expect.any(Function),
    );
  });

  it('lets other ledger errors roll the whole transaction back', async () => {
    post.mockRejectedValue(new Error('connection lost'));
    await expect(receive(event)).rejects.toThrow('connection lost');
  });

  it('allows the provider fields it does not read', () => {
    expect(
      service.parseEvent({ ...event, object: 'event', livemode: false }),
    ).toMatchObject(event);
  });

  it.each([null, [], 'evt_1', 42])('rejects the body %j', (body) => {
    expect(failure(() => service.parseEvent(body))).toEqual({
      status: 400,
      code: 'INVALID_WEBHOOK_EVENT',
      details: [{ field: 'body', issue: 'must be a JSON object' }],
    });
  });

  it.each([
    ['id', { ...event, id: undefined }],
    ['id', { ...event, id: 'evt 1' }],
    ['id', { ...event, id: 'e'.repeat(101) }],
    ['type', { ...event, type: 'Payment Succeeded' }],
    ['data', { ...event, data: 'paid' }],
    ['data', { ...event, data: undefined }],
  ])('rejects a bad %s', (field, body) => {
    const { status, code, details } = failure(() => service.parseEvent(body));
    expect([status, code]).toEqual([400, 'INVALID_WEBHOOK_EVENT']);
    expect(details?.map((d) => d.field)).toEqual([field]);
  });

  it.each([
    ['data.walletId', { ...event.data, walletId: 'w1' }],
    ['data.amount', { ...event.data, amount: 250 }],
    ['data.amount', { ...event.data, amount: '-1.00' }],
    ['data.amount', { ...event.data, amount: '0' }],
    ['data.amount', { ...event.data, amount: '1.001' }],
    ['data.currency', { ...event.data, currency: 'GBP' }],
  ])('rejects a payment.succeeded with a bad %s', (field, data) => {
    const { status, code, details } = failure(() => service.parseDeposit(data));
    expect([status, code]).toEqual([400, 'INVALID_WEBHOOK_EVENT']);
    expect(details?.map((d) => d.field)).toEqual([field]);
  });
});
