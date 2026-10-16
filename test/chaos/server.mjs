// Chaos target (A-B15.4): the built app with the global rate limit off, so k6 measures
// the stack, not the throttler. Bind 0.0.0.0 so Docker Desktop k6 can reach WSL via
// host.docker.internal. Stay up through Redis/Postgres disconnects (log, do not exit).
//   PORT=3100 node test/chaos/server.mjs   (after `npm run build`)
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../dist/app.module.js';
import { setupApp } from '../../dist/app.setup.js';

// Fault injection closes Redis/Postgres underfoot; unhandled ioredis errors must not
// take down the process or the load run measures only the crash, not recovery.
process.on('uncaughtException', (err) => {
  console.error('[chaos] uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[chaos] unhandledRejection', reason);
});

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ThrottlerGuard)
  .useValue({ canActivate: () => true })
  .compile();
const app = moduleRef.createNestApplication({ rawBody: true });
setupApp(app);
app.enableShutdownHooks();
const port = Number(process.env.PORT ?? 3100);
const host = process.env.CHAOS_HOST ?? '0.0.0.0';
await app.listen(port, host);
console.log(`chaos target listening on ${host}:${port}`);
