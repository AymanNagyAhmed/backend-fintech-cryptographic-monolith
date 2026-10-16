import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

/**
 * Testcontainers helpers (A-B15.2). Images come from `$MM/.env` (the same pins
 * as Compose) so tests never run an image the stack does not use. S3 (LocalStack)
 * is not started here: it needs `LOCALSTACK_AUTH_TOKEN`.
 */

const MM_ENV = resolve(process.cwd(), '../.env');

function pinned(name: string, fallback: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  if (existsSync(MM_ENV)) {
    const line = readFileSync(MM_ENV, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  }
  return fallback;
}

export function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface ContainerPostgres {
  container: StartedPostgreSqlContainer;
  /** `app_writer` runtime role, as in production. */
  appUrl: string;
  /** `migrator` schema owner. */
  migratorUrl: string;
}

const PASSWORDS = {
  migrator: 'tc-migrator-pass',
  appWriter: 'tc-app-writer-pass',
  auditorRo: 'tc-auditor-ro-pass',
};

/** PostgreSQL with the A-B3 roles; run {@link migrate} next. */
export async function startPostgres(): Promise<ContainerPostgres> {
  const container = await new PostgreSqlContainer(
    pinned('POSTGRES_IMAGE', 'postgres:18.6-alpine3.24'),
  )
    .withDatabase('fintech_tc')
    .withUsername('postgres')
    .withPassword('tc-superuser-pass')
    .withEnvironment({
      MIGRATOR_PASSWORD: PASSWORDS.migrator,
      APP_WRITER_PASSWORD: PASSWORDS.appWriter,
      AUDITOR_RO_PASSWORD: PASSWORDS.auditorRo,
    })
    .withCopyFilesToContainer([
      {
        source: resolve(process.cwd(), '../docker/postgres/init/01-roles.sql'),
        target: '/docker-entrypoint-initdb.d/01-roles.sql',
      },
    ])
    .start();
  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, pass: string) =>
    `postgresql://${user}:${pass}@${host}:${port}/fintech_tc`;
  return {
    container,
    appUrl: url('app_writer', PASSWORDS.appWriter),
    migratorUrl: url('migrator', PASSWORDS.migrator),
  };
}

/** `prisma migrate deploy` against the container, as the migrator role. */
export function migrate(migratorUrl: string): void {
  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATOR_DATABASE_URL: migratorUrl },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (res.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed:\n${res.stdout}\n${res.stderr}`,
    );
  }
}

export async function startRedis(
  password = 'tc-redis-pass',
): Promise<{ container: StartedRedisContainer; url: string }> {
  const container = await new RedisContainer(
    pinned('REDIS_IMAGE', 'redis:8.10.2-alpine'),
  )
    .withPassword(password)
    .start();
  return {
    container,
    url: `redis://:${password}@${container.getHost()}:${container.getMappedPort(6379)}`,
  };
}

export async function startOpenBao(
  rootToken = 'tc-root-token',
): Promise<{
  container: StartedTestContainer;
  addr: string;
  rootToken: string;
}> {
  const container = await new GenericContainer(
    pinned('BAO_IMAGE', 'openbao/openbao:2.7.1'),
  )
    .withExposedPorts(8200)
    .withCommand(['server', '-dev'])
    .withEnvironment({
      BAO_DEV_ROOT_TOKEN_ID: rootToken,
      BAO_DEV_LISTEN_ADDRESS: '0.0.0.0:8200',
    })
    .withAddedCapabilities('IPC_LOCK')
    .withWaitStrategy(Wait.forHttp('/v1/sys/health', 8200).forStatusCode(200))
    .start();
  return {
    container,
    addr: `http://${container.getHost()}:${container.getMappedPort(8200)}`,
    rootToken,
  };
}
