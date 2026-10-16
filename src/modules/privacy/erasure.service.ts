import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getRequestId } from '../../common/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { SubjectKeysService } from './subject-keys.service.js';

export interface ErasureView {
  id: string;
  subjectRef: string;
  status: string;
  requesterId: string;
  approverId: string | null;
}

/**
 * Four-eyes erasure: request then approve by a different compliance user (A-B11.3).
 * On approval, destroys the subject Transit key and records erasure.completed.
 */
@Injectable()
export class ErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: SubjectKeysService,
    private readonly outbox: OutboxService,
  ) {}

  async request(subjectRef: string, requesterId: string): Promise<ErasureView> {
    if (subjectRef === requesterId)
      throw new ForbiddenException('cannot request erasure of your own account here');
    const row = await this.prisma.erasureRequest.create({
      data: {
        subjectRef,
        requesterId,
        status: 'pending',
      },
    });
    return toView(row);
  }

  async approve(requestId: string, approverId: string): Promise<ErasureView> {
    const row = await this.prisma.erasureRequest.findUnique({
      where: { id: requestId },
    });
    if (!row) throw new NotFoundException('erasure request not found');
    if (row.status !== 'pending')
      throw new ConflictException(`erasure request is ${row.status}`);
    if (row.requesterId === approverId)
      throw new ForbiddenException('four-eyes: approver must differ from requester');

    await this.keys.deleteKey(row.subjectRef);

    const completed = await this.prisma.withTx(async (tx) => {
      const updated = await tx.erasureRequest.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          approverId,
          completedAt: new Date(),
        },
      });
      const requestIdHdr = getRequestId();
      await this.outbox.enqueue(tx, 'auth', {
        type: 'erasure.completed',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        actor: { subjectRef: approverId },
        ...(requestIdHdr !== undefined ? { requestId: requestIdHdr } : {}),
        subjectRef: row.subjectRef,
        requesterId: row.requesterId,
        approverId,
      });
      return updated;
    });
    return toView(completed);
  }
}

function toView(row: {
  id: string;
  subjectRef: string;
  status: string;
  requesterId: string;
  approverId: string | null;
}): ErasureView {
  return {
    id: row.id,
    subjectRef: row.subjectRef,
    status: row.status,
    requesterId: row.requesterId,
    approverId: row.approverId,
  };
}
