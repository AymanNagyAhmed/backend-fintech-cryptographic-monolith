import { outboxEventName } from './outbox-event-name.js';

describe('outboxEventName', () => {
  it('prefixes the payload type', () => {
    expect(outboxEventName('transfer.completed')).toBe(
      'outbox.transfer.completed',
    );
  });
});
