import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// The CLI (migrate, db, studio) connects as the schema owner; the app runtime uses DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  typedSql: {
    path: 'prisma/sql',
  },
  datasource: {
    url: process.env['MIGRATOR_DATABASE_URL'],
  },
});
