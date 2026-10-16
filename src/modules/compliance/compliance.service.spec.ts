import { ComplianceService } from './compliance.service.js';

describe('ComplianceService.search', () => {
  it('records audit.access and returns hits', async () => {
    const prisma = {
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            partitionKey: '1',
            seq: 2n,
            occurredAt: new Date('2026-10-16T12:00:00Z'),
            hash: 'aa'.repeat(32),
            payload: { type: 'transfer.completed' },
          },
        ]),
      },
    };
    const access = { record: vi.fn().mockResolvedValue('out') };
    const svc = new ComplianceService(prisma as never, access as never);
    const result = await svc.search('u1', { partitionKey: '1', type: 'transfer.completed' });
    expect(result.count).toBe(1);
    expect(result.hits[0]?.type).toBe('transfer.completed');
    expect(access.record).toHaveBeenCalledWith(
      'u1',
      'search',
      expect.stringContaining('partition=1'),
    );
  });
});
