import { ForbiddenException } from '@nestjs/common';
import { ErasureService } from './erasure.service.js';

describe('ErasureService', () => {
  it('refuses self-approval (four-eyes)', async () => {
    const prisma = {
      erasureRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'r1',
          subjectRef: 'u-subject',
          requesterId: 'u-req',
          status: 'pending',
        }),
      },
    };
    const keys = { deleteKey: vi.fn() };
    const outbox = { enqueue: vi.fn() };
    const svc = new ErasureService(
      prisma as never,
      keys as never,
      outbox as never,
    );
    await expect(svc.approve('r1', 'u-req')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(keys.deleteKey).not.toHaveBeenCalled();
  });
});
