import { redactWebhookPayload } from './webhook-payload.js';

const data = {
  walletId: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70',
  amount: '250.00',
  currency: 'AED',
};

describe('redactWebhookPayload', () => {
  it('keeps only the allow-listed fields of a payment.succeeded event', () => {
    const body = {
      id: 'evt_1',
      type: 'payment.succeeded',
      created: 1760464800,
      object: 'event',
      livemode: false,
      data: {
        ...data,
        customer: { email: 'a@b.c', name: 'Alice' },
        card: { last4: '4242' },
        description: 'Order 42',
      },
    };
    expect(redactWebhookPayload(body, body.type)).toEqual({
      id: 'evt_1',
      type: 'payment.succeeded',
      created: 1760464800,
      data,
    });
  });

  it('keeps no data for a type without a data allow-list', () => {
    expect(
      redactWebhookPayload(
        { id: 'evt_2', type: 'payment.refunded', data: { amount: '1.00' } },
        'payment.refunded',
      ),
    ).toEqual({ id: 'evt_2', type: 'payment.refunded' });
  });

  it.each([
    ['an object', { nested: true }],
    ['an array', ['a']],
    ['null', null],
    ['a string over 100 characters', 'x'.repeat(101)],
    ['a non-finite number', Number.POSITIVE_INFINITY],
  ])('drops an allow-listed field holding %s', (_, created) => {
    expect(
      redactWebhookPayload(
        { id: 'evt_3', type: 'test.ping', created, data: {} },
        'test.ping',
      ),
    ).toEqual({ id: 'evt_3', type: 'test.ping' });
  });

  it('does not take allow-listed names from the prototype', () => {
    const body = Object.create({ created: 'inherited' }) as Record<
      string,
      unknown
    >;
    Object.assign(body, { id: 'evt_4', type: 'test.ping', data: {} });
    expect(redactWebhookPayload(body, 'test.ping')).toEqual({
      id: 'evt_4',
      type: 'test.ping',
    });
  });

  it('does not treat Object.prototype names as event types', () => {
    expect(
      redactWebhookPayload(
        { id: 'evt_5', type: 'constructor', data: { a: 1 } },
        'constructor',
      ),
    ).toEqual({ id: 'evt_5', type: 'constructor' });
  });
});
