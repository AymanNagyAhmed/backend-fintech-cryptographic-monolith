import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { NotFoundException } from '@nestjs/common';
import { SthReceiptsService } from './sth-receipts.service.js';
import type { SthService } from './sth.service.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

const anchored = {
  id: 's1',
  treeSize: 4,
  rootHash: 'ab'.repeat(32),
  timestamp: '2026-10-16T20:00:00.000Z',
  previousSthHash: null,
  alg: 'ed25519',
  keyId: 'audit-signing:v1',
  signature: 'dGVzdA==',
  hasTsaToken: true,
  timeAnchored: true,
  clockQuality: 'ok' as const,
};

describe('SthReceiptsService', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockClear();
    vi.mocked(writeFile).mockClear();
    vi.mocked(appendFile).mockClear();
  });

  it('does not write a receipt when no head is time-anchored', async () => {
    const sth = {
      latestAnchored: vi
        .fn()
        .mockRejectedValue(
          new NotFoundException('no time-anchored tree head published yet'),
        ),
      latest: vi.fn(),
    } as unknown as SthService;
    const service = new SthReceiptsService({} as never, sth);
    await expect(service.pushLatest()).resolves.toEqual({ pushed: false });
    expect(sth.latest).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('writes a receipt for the newest anchored head', async () => {
    const sth = {
      latestAnchored: vi.fn().mockResolvedValue(anchored),
    } as unknown as SthService;
    const service = new SthReceiptsService({} as never, sth);
    await expect(service.pushLatest()).resolves.toEqual({
      pushed: true,
      treeSize: 4,
    });
    expect(appendFile).toHaveBeenCalledOnce();
    expect(vi.mocked(appendFile).mock.calls[0]?.[1]).toEqual(
      expect.stringContaining('"timeAnchored":true'),
    );
    expect(writeFile).toHaveBeenCalledOnce();
  });
});
