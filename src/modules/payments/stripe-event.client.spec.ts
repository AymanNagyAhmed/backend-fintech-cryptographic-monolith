import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { ProviderEventUnavailable } from './provider-events.js';
import {
  StripeEventClient,
  providerPaymentFromStripeEvent,
} from './stripe-event.client.js';

const SECRET = 's'.repeat(40);
const WALLET = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70';

function clientOf(
  fetchFn: typeof fetch,
  secret: string | null = SECRET,
): StripeEventClient {
  const client = new StripeEventClient({
    get: (key: string) =>
      key === 'STRIPE_SECRET_KEY'
        ? (secret ?? undefined)
        : key === 'STRIPE_API_BASE'
          ? 'https://api.stripe.com'
          : undefined,
  } as unknown as ConfigService<EnvironmentVariables, true>);
  client.fetchFn = fetchFn;
  return client;
}

describe('providerPaymentFromStripeEvent', () => {
  it('reads this platform event shape', () => {
    expect(
      providerPaymentFromStripeEvent({
        id: 'evt_1',
        data: { walletId: WALLET, amount: '250.00', currency: 'AED' },
      }),
    ).toEqual({
      provider: 'stripe',
      eventId: 'evt_1',
      destination: WALLET,
      amount: '250.00',
      currency: 'AED',
    });
  });

  it('reads a Stripe event with minor units and metadata.walletId', () => {
    expect(
      providerPaymentFromStripeEvent({
        id: 'evt_1',
        data: {
          object: {
            amount: 25000,
            currency: 'aed',
            metadata: { walletId: WALLET },
          },
        },
      }),
    ).toEqual({
      provider: 'stripe',
      eventId: 'evt_1',
      destination: WALLET,
      amount: '250.00',
      currency: 'AED',
    });
  });

  it('returns null when the event has no destination', () => {
    expect(
      providerPaymentFromStripeEvent({
        id: 'evt_1',
        data: { object: { amount: 100, currency: 'aed', metadata: {} } },
      }),
    ).toBeNull();
  });
});

describe('StripeEventClient', () => {
  it('retrieves the event by id with the bearer secret', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'evt_1',
            data: { walletId: WALLET, amount: '10.00', currency: 'AED' },
          }),
          { status: 200 },
        ),
    );
    const record = await clientOf(fetchFn).load('stripe', 'evt_1');
    expect(record.amount).toBe('10.00');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/events/evt_1',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
    );
  });

  it('fails closed when the key is unset, the call fails, or the body is not an event', async () => {
    const fetchFn = vi.fn();
    await expect(
      clientOf(fetchFn, null).load('stripe', 'evt_1'),
    ).rejects.toBeInstanceOf(ProviderEventUnavailable);
    expect(fetchFn).not.toHaveBeenCalled();

    fetchFn.mockRejectedValueOnce(new Error('network'));
    await expect(
      clientOf(fetchFn).load('stripe', 'evt_1'),
    ).rejects.toBeInstanceOf(ProviderEventUnavailable);

    fetchFn.mockResolvedValueOnce(new Response('no', { status: 404 }));
    await expect(
      clientOf(fetchFn).load('stripe', 'evt_1'),
    ).rejects.toBeInstanceOf(ProviderEventUnavailable);
  });
});
