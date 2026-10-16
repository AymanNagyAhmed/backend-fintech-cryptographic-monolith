// Child process for test/outbox-dispatcher.e2e-spec.ts. Claims a wallet outbox batch, writes the
// audit leaves in the dispatcher transaction, then hangs inside a second handler as soon as it
// sees one of the target rows, so the parent can SIGKILL it mid-dispatch (A-B14.3).
// argv: <comma separated outbox ids>. Needs DATABASE_URL in the environment.
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../src/database/prisma.service.js';
import { ChainerService } from '../../src/modules/audit/chainer.service.js';
import type { OutboxEvent } from '../../src/modules/outbox/interfaces/outbox-event.interface.js';
import { OutboxDispatcherService } from '../../src/modules/outbox/outbox-dispatcher.service.js';
import { OutboxService } from '../../src/modules/outbox/outbox.service.js';

const targets = new Set((process.argv[2] ?? '').split(',').filter(Boolean));

const config = new ConfigService({ DATABASE_URL: process.env.DATABASE_URL });
const prisma = new PrismaService(config as never);
const emitter = new EventEmitter2({ wildcard: true, delimiter: '.' });
const outbox = new OutboxService();
const chainer = new ChainerService(prisma, outbox, {
  get: () => 10,
} as never);

emitter.on('outbox.**', async (event: OutboxEvent) => {
  await chainer.chainRow(event.tx, event);
});
emitter.on('outbox.**', async (event: OutboxEvent) => {
  if (!targets.has(event.id)) return;
  console.log(`HANGING ${event.id}`);
  await new Promise(() => undefined);
});

await new OutboxDispatcherService(prisma, emitter, outbox).dispatch(
  'wallet',
  1000,
);
console.log('FINISHED');
await prisma.$disconnect();
