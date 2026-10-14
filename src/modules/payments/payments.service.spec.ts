import type { DomainException } from '../../common/exceptions/domain.exception.js';
import { PaymentsService } from './payments.service.js';

const event = {
  id: 'evt_3PqR8s2eZvKYlo2C',
  type: 'payment.succeeded',
  data: { walletId: 'w1', amount: '250.00', currency: 'AED' },
};

const failure = (body: unknown) => {
  try {
    new PaymentsService().parseEvent(body);
  } catch (e) {
    const err = e as DomainException;
    return { status: err.statusCode, code: err.code, details: err.details };
  }
  throw new Error('expected parseEvent to throw');
};

describe('PaymentsService', () => {
  const service = new PaymentsService();

  it('answers a receipt with the event id and type', () => {
    expect(service.receive('stripe', event)).toEqual({
      provider: 'stripe',
      eventId: 'evt_3PqR8s2eZvKYlo2C',
      type: 'payment.succeeded',
      status: 'received',
    });
  });

  it('allows the provider fields it does not read', () => {
    expect(
      service.parseEvent({ ...event, object: 'event', livemode: false }),
    ).toMatchObject(event);
  });

  it.each([null, [], 'evt_1', 42])('rejects the body %j', (body) => {
    expect(failure(body)).toEqual({
      status: 400,
      code: 'INVALID_WEBHOOK_EVENT',
      details: [{ field: 'body', issue: 'must be a JSON object' }],
    });
  });

  it.each([
    ['id', { ...event, id: undefined }],
    ['id', { ...event, id: 'evt 1' }],
    ['id', { ...event, id: 'e'.repeat(256) }],
    ['type', { ...event, type: 'Payment Succeeded' }],
    ['data', { ...event, data: 'paid' }],
    ['data', { ...event, data: undefined }],
  ])('rejects a bad %s', (field, body) => {
    const { status, code, details } = failure(body);
    expect([status, code]).toEqual([400, 'INVALID_WEBHOOK_EVENT']);
    expect(details?.map((d) => d.field)).toEqual([field]);
  });
});
