import { TsaService } from './tsa.service.js';

describe('TsaService', () => {
  it('skips stamping when tsa_token is already set', async () => {
    const prisma = {
      treeHead: {
        findUnique: vi.fn().mockResolvedValue({ tsaToken: Buffer.from('x') }),
        update: vi.fn(),
      },
    };
    const service = new TsaService(prisma as never, {
      get: () => 'https://freetsa.org/tsr',
    } as never);
    await service.stampTreeHead('sth1', {
      treeSize: 1,
      rootHash: 'aa'.repeat(32),
      timestamp: '2026-10-16T20:00:00.000Z',
      previousSthHash: null,
    });
    expect(prisma.treeHead.update).not.toHaveBeenCalled();
  });
});
