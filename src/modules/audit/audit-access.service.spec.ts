import type { PrismaService } from '../../database/prisma.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import { AuditAccessService } from './audit-access.service.js';

vi.mock('../../common/request-context.js', () => ({
  getRequestId: vi.fn(() => 'req_audit_access'),
}));

describe('AuditAccessService', () => {
  it('enqueues audit.access onto auth.outbox', async () => {
    const enqueue = vi.fn().mockResolvedValue('out-1');
    const tx = {};
    const withTx = vi.fn(async (fn: (t: unknown) => unknown) => fn(tx));
    const service = new AuditAccessService(
      { withTx } as unknown as PrismaService,
      { enqueue } as unknown as OutboxService,
    );
    await expect(
      service.record('user-1', 'verify', 'partition=1'),
    ).resolves.toBe('out-1');
    expect(enqueue).toHaveBeenCalledWith(tx, 'auth', {
      type: 'audit.access',
      schemaVersion: 1,
      occurredAt: expect.any(String),
      actor: { subjectRef: 'user-1' },
      requestId: 'req_audit_access',
      operation: 'verify',
      scope: 'partition=1',
    });
  });
});
