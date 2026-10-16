import { PiiScannerService } from './pii-scanner.service.js';

describe('PiiScannerService', () => {
  it('flags email-shaped plaintext in payloads', async () => {
    const prisma = {
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            partitionKey: '0',
            seq: 1n,
            payload: { note: 'contact me@example.com please' },
          },
        ]),
      },
    };
    const report = await new PiiScannerService(prisma as never).scan();
    expect(report.ok).toBe(false);
    expect(report.hits).toHaveLength(1);
  });

  it('passes when payloads have only subjectRef', async () => {
    const prisma = {
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            partitionKey: '0',
            seq: 1n,
            payload: { actor: { subjectRef: 'u1' }, type: 'wallet.created' },
          },
        ]),
      },
    };
    await expect(new PiiScannerService(prisma as never).scan()).resolves.toMatchObject(
      { ok: true, hits: [] },
    );
  });
});
