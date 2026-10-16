import { prepareAuditEvent } from '../../shared-kernel/audit/prepare-audit-event.js';
import { OutboxService } from './outbox.service.js';

vi.mock('../../shared-kernel/audit/prepare-audit-event.js', () => ({
  prepareAuditEvent: vi.fn((input: unknown) => input),
}));

vi.mock('../../common/request-context.js', () => ({
  getRequestId: vi.fn(() => 'req_test'),
}));

describe('OutboxService.enqueue', () => {
  const event = {
    type: 'transfer.completed',
    schemaVersion: 1,
    occurredAt: '2026-10-16T18:00:00.000Z',
    actor: { subjectRef: 'u1' },
    transferId: '11111111-1111-4111-8111-111111111111',
    sourceWalletId: '22222222-2222-4222-8222-222222222222',
    destinationWalletId: '33333333-3333-4333-8333-333333333333',
    currency: 'AED',
    amount: '10.50',
  };

  it.each(['auth', 'wallet', 'ledger', 'payments'] as const)(
    'prepares the payload and inserts into %s.outbox',
    async (context) => {
      const create = vi.fn().mockResolvedValue({ id: 'out-1' });
      const tx = {
        authOutbox: { create },
        walletOutbox: { create },
        ledgerOutbox: { create },
        paymentsOutbox: { create },
      };
      const service = new OutboxService();
      await expect(service.enqueue(tx as never, context, event)).resolves.toBe(
        'out-1',
      );
      expect(prepareAuditEvent).toHaveBeenCalledWith(event);
      expect(create).toHaveBeenCalledWith({ data: { payload: event } });
      expect(create).toHaveBeenCalledTimes(1);
    },
  );
});
