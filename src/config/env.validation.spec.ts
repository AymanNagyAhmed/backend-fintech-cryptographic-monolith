import { validate } from './env.validation.js';

const secret = 'x'.repeat(64);

const validEnv = (): Record<string, string> => ({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://app_writer:pw@localhost:5432/test_01',
  MIGRATOR_DATABASE_URL: 'postgresql://migrator:pw@localhost:5432/test_01',
  REDIS_URL: 'redis://:pw@localhost:6379',
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:8080',
  WEBHOOK_SECRET_STRIPE: secret,
  BAO_ADDR: 'http://localhost:8200',
  BAO_TOKEN: 'y'.repeat(48),
  SIGNING_KEY_NAME: 'audit-signing',
  SIGNING_ALG: 'ed25519',
  TSA_URL: 'https://freetsa.org/tsr',
  WORM_BUCKET: 'audit-worm',
  S3_ENDPOINT: 'http://localhost:4566',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  CHECKPOINT_INTERVAL_SEC: '60',
});

describe('env validation', () => {
  it('accepts a complete config and converts numbers', () => {
    const env = validate(validEnv());
    expect(env.PORT).toBe(3000);
    expect(env.CHECKPOINT_INTERVAL_SEC).toBe(60);
  });

  it.each(['JWT_ACCESS_SECRET', 'DATABASE_URL', 'BAO_TOKEN', 'WEBHOOK_SECRET_STRIPE', 'TOTP_ENCRYPTION_KEY'])(
    'refuses to start when %s is missing',
    (key) => {
      const env = validEnv();
      delete env[key];
      expect(() => validate(env)).toThrow(new RegExp(`- ${key}:`));
    },
  );

  const messageOf = (env: Record<string, string>): string => {
    try {
      validate(env);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected validation to fail');
  };

  it('rejects the change-me placeholder and short secrets', () => {
    const msg = messageOf({ ...validEnv(), JWT_REFRESH_SECRET: 'change-me', JWT_ACCESS_SECRET: 'short' });
    expect(msg).toContain('- JWT_REFRESH_SECRET:');
    expect(msg).toContain('- JWT_ACCESS_SECRET:');
  });

  it('never echoes secret values in the error', () => {
    const leaked = 'super-secret-but-too-short';
    expect(messageOf({ ...validEnv(), JWT_ACCESS_SECRET: leaked })).not.toContain(leaked);
  });

  it('rejects an unknown signing algorithm and a bad port', () => {
    const msg = messageOf({ ...validEnv(), SIGNING_ALG: 'rsa', PORT: '70000' });
    expect(msg).toContain('- SIGNING_ALG:');
    expect(msg).toContain('- PORT:');
  });
});
