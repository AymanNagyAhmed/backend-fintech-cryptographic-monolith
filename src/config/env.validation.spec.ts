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
  API_CLIENT_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
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

  it.each([
    'JWT_ACCESS_SECRET',
    'DATABASE_URL',
    'BAO_TOKEN',
    'WEBHOOK_SECRET_STRIPE',
    'TOTP_ENCRYPTION_KEY',
    'API_CLIENT_ENCRYPTION_KEY',
  ])('refuses to start when %s is missing', (key) => {
    const env = validEnv();
    delete env[key];
    expect(() => validate(env)).toThrow(new RegExp(`- ${key}:`));
  });

  const messageOf = (env: Record<string, string>): string => {
    try {
      validate(env);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected validation to fail');
  };

  it('rejects the change-me placeholder and short secrets', () => {
    const msg = messageOf({
      ...validEnv(),
      JWT_REFRESH_SECRET: 'change-me',
      JWT_ACCESS_SECRET: 'short',
    });
    expect(msg).toContain('- JWT_REFRESH_SECRET:');
    expect(msg).toContain('- JWT_ACCESS_SECRET:');
  });

  it('never echoes secret values in the error', () => {
    const leaked = 'super-secret-but-too-short';
    expect(
      messageOf({ ...validEnv(), JWT_ACCESS_SECRET: leaked }),
    ).not.toContain(leaked);
  });

  it('rejects an unknown signing algorithm and a bad port', () => {
    const msg = messageOf({ ...validEnv(), SIGNING_ALG: 'rsa', PORT: '70000' });
    expect(msg).toContain('- SIGNING_ALG:');
    expect(msg).toContain('- PORT:');
  });

  it('defaults SIGNER_BACKEND to openbao and refuses an unknown backend', () => {
    expect(validate(validEnv()).SIGNER_BACKEND).toBe('openbao');
    expect(
      validate({ ...validEnv(), SIGNER_BACKEND: 'aws-kms' }).SIGNER_BACKEND,
    ).toBe('aws-kms');
    expect(messageOf({ ...validEnv(), SIGNER_BACKEND: 'file' })).toContain(
      '- SIGNER_BACKEND:',
    );
  });

  it('accepts optional BAO_ADMIN_TOKEN and refuses the change-me placeholder', () => {
    expect(validate(validEnv()).BAO_ADMIN_TOKEN).toBeUndefined();
    expect(
      validate({ ...validEnv(), BAO_ADMIN_TOKEN: 'z'.repeat(48) })
        .BAO_ADMIN_TOKEN,
    ).toBe('z'.repeat(48));
    expect(
      messageOf({ ...validEnv(), BAO_ADMIN_TOKEN: 'change-me' }),
    ).toContain('- BAO_ADMIN_TOKEN:');
  });

  it('refuses the local signer in production only', () => {
    expect(
      validate({ ...validEnv(), SIGNER_BACKEND: 'local' }).SIGNER_BACKEND,
    ).toBe('local');
    expect(
      messageOf({
        ...validEnv(),
        NODE_ENV: 'production',
        SIGNER_BACKEND: 'local',
      }),
    ).toContain(
      '- SIGNER_BACKEND: local keeps keys in memory and is refused in production',
    );
  });

  it.each(['Audit', 'alias/audit-signing', 'audit signing', ''])(
    'rejects SIGNING_KEY_NAME=%j',
    (name) => {
      expect(messageOf({ ...validEnv(), SIGNING_KEY_NAME: name })).toContain(
        '- SIGNING_KEY_NAME:',
      );
    },
  );

  it('defaults TRUST_PROXY to 0 and accepts a hop count', () => {
    expect(validate(validEnv()).TRUST_PROXY).toBe(0);
    expect(validate({ ...validEnv(), TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(messageOf({ ...validEnv(), TRUST_PROXY: 'true' })).toContain(
      '- TRUST_PROXY:',
    );
  });

  it('defaults RECONCILIATION_CRON to 01:00 and checks the field count', () => {
    expect(validate(validEnv()).RECONCILIATION_CRON).toBe('0 1 * * *');
    for (const cron of ['*/5 * * * *', '0 30 2 * * MON-FRI'])
      expect(
        validate({ ...validEnv(), RECONCILIATION_CRON: cron })
          .RECONCILIATION_CRON,
      ).toBe(cron);
    for (const cron of ['nightly', '0 1 * *', '0 1 * * * * *', '0 1 * * *; rm'])
      expect(messageOf({ ...validEnv(), RECONCILIATION_CRON: cron })).toContain(
        '- RECONCILIATION_CRON:',
      );
  });

  it('defaults IDEMPOTENCY_PURGE_CRON to 01:30 and rejects a bad pattern', () => {
    expect(validate(validEnv()).IDEMPOTENCY_PURGE_CRON).toBe('30 1 * * *');
    expect(
      messageOf({ ...validEnv(), IDEMPOTENCY_PURGE_CRON: 'nightly' }),
    ).toContain('- IDEMPOTENCY_PURGE_CRON:');
  });

  it('defaults CHAINER_CRON and CHAINER_BATCH_SIZE', () => {
    const env = validate(validEnv());
    expect(env.CHAINER_CRON).toBe('*/5 * * * * *');
    expect(env.CHAINER_BATCH_SIZE).toBe(50);
    expect(
      validate({ ...validEnv(), CHAINER_BATCH_SIZE: '10' }).CHAINER_BATCH_SIZE,
    ).toBe(10);
    expect(messageOf({ ...validEnv(), CHAINER_CRON: 'often' })).toContain(
      '- CHAINER_CRON:',
    );
  });

  it('defaults AUDIT_PARTITION_COUNT to 16 and accepts 1|4|16', () => {
    expect(validate(validEnv()).AUDIT_PARTITION_COUNT).toBe(16);
    expect(
      validate({ ...validEnv(), AUDIT_PARTITION_COUNT: '4' })
        .AUDIT_PARTITION_COUNT,
    ).toBe(4);
    expect(
      messageOf({ ...validEnv(), AUDIT_PARTITION_COUNT: '0' }),
    ).toContain('- AUDIT_PARTITION_COUNT:');
  });

  it('defaults the daily transfer limits and accepts amounts at the currency scale', () => {
    const env = validate(validEnv());
    expect([
      env.TRANSFER_DAILY_LIMIT_AED,
      env.TRANSFER_DAILY_LIMIT_USD,
      env.TRANSFER_DAILY_LIMIT_EUR,
      env.TRANSFER_DAILY_LIMIT_BTC,
    ]).toEqual(['50000.00', '15000.00', '15000.00', '1.00000000']);
    expect(
      validate({ ...validEnv(), TRANSFER_DAILY_LIMIT_AED: '250' })
        .TRANSFER_DAILY_LIMIT_AED,
    ).toBe('250');
    expect(
      validate({ ...validEnv(), TRANSFER_DAILY_LIMIT_BTC: '0.00000001' })
        .TRANSFER_DAILY_LIMIT_BTC,
    ).toBe('0.00000001');
  });

  it.each([
    ['TRANSFER_DAILY_LIMIT_AED', '0'],
    ['TRANSFER_DAILY_LIMIT_AED', '0.00'],
    ['TRANSFER_DAILY_LIMIT_AED', '-1.00'],
    ['TRANSFER_DAILY_LIMIT_USD', '1.001'],
    ['TRANSFER_DAILY_LIMIT_EUR', '1e6'],
    ['TRANSFER_DAILY_LIMIT_EUR', '1000000000000'],
    ['TRANSFER_DAILY_LIMIT_BTC', '0.000000001'],
  ])('rejects %s=%s', (key, value) => {
    expect(messageOf({ ...validEnv(), [key]: value })).toContain(`- ${key}:`);
  });
});
