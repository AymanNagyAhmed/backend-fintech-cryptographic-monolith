// `npm run seed` / `make seed` (prisma db seed). Runs as app_writer (DATABASE_URL), like the app.
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import {
  DEMO_USERS,
  createSeedServices,
  seedDemoData,
} from '../scripts/seed.js';
import { validate } from '../src/config/env.validation.js';

const PASSWORD_MIN = 12; // same as RegisterDto

if (existsSync('.env')) process.loadEnvFile('.env');
const env = validate(process.env);
if (env.NODE_ENV === 'production') {
  console.error('seed: refusing to run with NODE_ENV=production');
  process.exit(1);
}
const password = process.env.SEED_USER_PASSWORD ?? '';
if (password.length < PASSWORD_MIN) {
  console.error(
    `seed: set SEED_USER_PASSWORD (at least ${PASSWORD_MIN} characters) in .env; ` +
      'it becomes the password of the demo users',
  );
  process.exit(1);
}

const services = createSeedServices(env);
try {
  const results = await seedDemoData(services, password, DEMO_USERS);
  for (const r of results) {
    console.log(`${r.email} (${r.userCreated ? 'created' : 'existing'})`);
    for (const w of r.wallets)
      console.log(
        `  ${w.currency} ${w.balance.padStart(14)}  wallet ${w.walletId}` +
          `${w.created ? ' (new)' : ''}${w.posted ? '' : ' (opening balance already posted)'}`,
      );
  }
  if (results.some((r) => !r.userCreated))
    console.log('Existing users keep their password.');
} finally {
  await services.prisma.$disconnect();
}
