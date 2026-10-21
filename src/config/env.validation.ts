import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  NotEquals,
  validateSync,
} from 'class-validator';

const PLACEHOLDER = 'change-me';
const DURATION = /^\d+[smhd]$/;
const CRON = /^[\d*/,?LW#A-Za-z-]+( [\d*/,?LW#A-Za-z-]+){4,5}$/;
const LOCAL_URL = { require_tld: false, require_protocol: true };
// Positive decimal strings within NUMERIC(20, 8) at the currency scale; zero is refused
const LIMIT_FIAT = /^(?!0+(\.0+)?$)\d{1,12}(\.\d{1,2})?$/;
const LIMIT_FIAT_MESSAGE =
  '$property must be a positive amount with up to 2 decimals';
const LIMIT_BTC = /^(?!0+(\.0+)?$)\d{1,12}(\.\d{1,8})?$/;

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const SIGNING_ALGS = ['ed25519', 'ecdsa-p256', 'ml-dsa-65'] as const;
export const SIGNER_BACKENDS = ['openbao', 'aws-kms', 'local'] as const;

export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: '$property must be a postgresql:// URL',
  })
  DATABASE_URL: string;

  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: '$property must be a postgresql:// URL',
  })
  MIGRATOR_DATABASE_URL: string;

  @Matches(/^rediss?:\/\/.+/, {
    message: '$property must be a redis:// or rediss:// URL',
  })
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  @NotEquals(PLACEHOLDER)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  @NotEquals(PLACEHOLDER)
  JWT_REFRESH_SECRET: string;

  @Matches(DURATION, { message: '$property must look like 15m, 7d, 3600s' })
  JWT_ACCESS_TTL: string;

  @Matches(DURATION, { message: '$property must look like 15m, 7d, 3600s' })
  JWT_REFRESH_TTL: string;

  // AES-256-GCM key for TOTP secrets at rest: 32 random bytes, base64 (openssl rand -base64 32)
  @Matches(/^[A-Za-z0-9+/]{43}=$/, {
    message: '$property must be 32 bytes, base64 (openssl rand -base64 32)',
  })
  TOTP_ENCRYPTION_KEY: string;

  // AES-256-GCM key for B2B HMAC secrets at rest (auth.api_clients); separate from the TOTP key
  @Matches(/^[A-Za-z0-9+/]{43}=$/, {
    message: '$property must be 32 bytes, base64 (openssl rand -base64 32)',
  })
  API_CLIENT_ENCRYPTION_KEY: string;

  @Matches(/^https?:\/\/[^,\s]+(,https?:\/\/[^,\s]+)*$/, {
    message: '$property must be a comma-separated list of http(s) origins',
  })
  CORS_ORIGINS: string;

  // Reverse proxies in front of the app; 0 = use the socket address. Rate limits key on the client IP.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY: number = 0;

  // Wallets a user may hold that are not closed (POST /wallets answers WALLET_LIMIT_REACHED beyond it)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  WALLETS_MAX_PER_USER: number = 10;

  // Outgoing transfers per source wallet and UTC day (POST /transfers answers DAILY_LIMIT_EXCEEDED beyond it)
  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  TRANSFER_DAILY_LIMIT_AED: string = '50000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  TRANSFER_DAILY_LIMIT_USD: string = '15000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  TRANSFER_DAILY_LIMIT_EUR: string = '15000.00';

  @IsOptional()
  @Matches(LIMIT_BTC, {
    message: '$property must be a positive amount with up to 8 decimals',
  })
  TRANSFER_DAILY_LIMIT_BTC: string = '1.00000000';

  // Hours after TOTP confirmation before an allow-listed beneficiary becomes usable (A-B13.1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(720)
  BENEFICIARY_ACTIVATION_DELAY_HOURS: number = 24;

  // Withdrawal policy (A-B13.2): daily cap, four-eyes threshold, large-amount delay
  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_DAILY_LIMIT_AED: string = '20000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_DAILY_LIMIT_USD: string = '5000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_DAILY_LIMIT_EUR: string = '5000.00';

  @IsOptional()
  @Matches(LIMIT_BTC, {
    message: '$property must be a positive amount with up to 8 decimals',
  })
  WITHDRAWAL_DAILY_LIMIT_BTC: string = '0.25000000';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_APPROVAL_THRESHOLD_AED: string = '5000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_APPROVAL_THRESHOLD_USD: string = '1500.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_APPROVAL_THRESHOLD_EUR: string = '1500.00';

  @IsOptional()
  @Matches(LIMIT_BTC, {
    message: '$property must be a positive amount with up to 8 decimals',
  })
  WITHDRAWAL_APPROVAL_THRESHOLD_BTC: string = '0.05000000';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_LARGE_DELAY_THRESHOLD_AED: string = '1000.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_LARGE_DELAY_THRESHOLD_USD: string = '300.00';

  @IsOptional()
  @Matches(LIMIT_FIAT, { message: LIMIT_FIAT_MESSAGE })
  WITHDRAWAL_LARGE_DELAY_THRESHOLD_EUR: string = '300.00';

  @IsOptional()
  @Matches(LIMIT_BTC, {
    message: '$property must be a positive amount with up to 8 decimals',
  })
  WITHDRAWAL_LARGE_DELAY_THRESHOLD_BTC: string = '0.01000000';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(168)
  WITHDRAWAL_LARGE_DELAY_HOURS: number = 24;

  // Max percent of liabilities that may sit in the hot wallet before alert (A-B13.4)
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  HOT_WALLET_MAX_SHARE: number = 5;

  // Cron pattern (5 or 6 fields, UTC) of the nightly ledger reconciliation job
  @IsOptional()
  @Matches(CRON, { message: '$property must be a cron pattern like 0 1 * * *' })
  RECONCILIATION_CRON: string = '0 1 * * *';

  // Cron pattern (UTC) of the nightly purge of idempotency keys older than 30 days
  @IsOptional()
  @Matches(CRON, {
    message: '$property must be a cron pattern like 30 1 * * *',
  })
  IDEMPOTENCY_PURGE_CRON: string = '30 1 * * *';

  // Outbox -> audit_events drain (BullMQ). Default every 5 seconds (6-field cron).
  @IsOptional()
  @Matches(CRON, {
    message: '$property must be a cron pattern like */5 * * * * *',
  })
  CHAINER_CRON: string = '*/5 * * * * *';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  CHAINER_BATCH_SIZE: number = 50;

  // Warn when unprocessed outbox rows >= this (A-B9.7); requests never wait on the chainer
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  OUTBOX_LAG_ALERT_THRESHOLD: number = 1000;

  // How many logical hash-chain partitions audit events are hashed into (A-B9.10 k6: 1, 4, 16)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(256)
  AUDIT_PARTITION_COUNT: number = 16;

  @IsString()
  @MinLength(32)
  @NotEquals(PLACEHOLDER)
  WEBHOOK_SECRET_STRIPE: string;

  /**
   * Stripe secret key for `GET /v1/events/:id`. Optional: when unset, a signed
   * `payment.succeeded` is stored rejected and is not credited. Not the webhook HMAC secret.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  @NotEquals(PLACEHOLDER)
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsUrl(LOCAL_URL)
  STRIPE_API_BASE: string = 'https://api.stripe.com';

  @IsUrl(LOCAL_URL)
  BAO_ADDR: string;

  @IsString()
  @MinLength(16)
  @NotEquals(PLACEHOLDER)
  BAO_TOKEN: string;

  /**
   * OpenBao token that may rotate / create Transit keys (ops). Optional: when unset,
   * rotation falls back to BAO_TOKEN. The Nest sign path must use an `audit-signer`
   * token in BAO_TOKEN (A-B8.8); keep the root token here for `make rotate-key`.
   */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @NotEquals(PLACEHOLDER)
  BAO_ADMIN_TOKEN?: string;

  // Key store behind the Signer: OpenBao Transit (dev), AWS KMS (prod), in-memory keys (tests only)
  @IsOptional()
  @IsIn(SIGNER_BACKENDS)
  SIGNER_BACKEND: (typeof SIGNER_BACKENDS)[number] = 'openbao';

  // Transit key name, or the KMS alias without "alias/"
  @Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/, {
    message: '$property must be 1-64 characters of a-z 0-9 _ -',
  })
  SIGNING_KEY_NAME: string;

  // Non-exportable custody key (OpenBao Transit / KMS); MPC is the production target
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/, {
    message: '$property must be 1-64 characters of a-z 0-9 _ -',
  })
  CUSTODY_SIGNING_KEY_NAME: string = 'custody-signing';

  @IsIn(SIGNING_ALGS)
  SIGNING_ALG: (typeof SIGNING_ALGS)[number];

  @IsUrl({ require_protocol: true })
  TSA_URL: string;

  @IsString()
  @IsNotEmpty()
  WORM_BUCKET: string;

  @IsUrl(LOCAL_URL)
  S3_ENDPOINT: string;

  @IsString()
  @IsNotEmpty()
  AWS_REGION: string;

  @IsString()
  @IsNotEmpty()
  AWS_ACCESS_KEY_ID: string;

  @IsString()
  @IsNotEmpty()
  AWS_SECRET_ACCESS_KEY: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  CHECKPOINT_INTERVAL_SEC: number;

  /**
   * Max |chronyc System time| offset in seconds before records are stamped
   * clockQuality=degraded and Prometheus alerts (A-B16.5 / 2.9). Default 100ms.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(60)
  CLOCK_OFFSET_TOLERANCE_SEC: number = 0.1;

  /** chronyc = shell out to chronyc tracking; stub = offset 0 / ok (tests). */
  @IsOptional()
  @IsIn(['chronyc', 'stub'])
  CLOCK_QUALITY_SOURCE: 'chronyc' | 'stub' = 'chronyc';

  @IsOptional()
  @IsString()
  @MinLength(1)
  CLOCK_CHRONYC_BIN: string = 'chronyc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60_000)
  CLOCK_QUALITY_CACHE_MS: number = 5_000;
}

// Error text names the variable and the rule only; values are never echoed because they may be secrets.
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(env, { skipMissingProperties: false });
  const lines = errors.map(
    (e) =>
      `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
  );
  if (env.NODE_ENV === 'production' && env.SIGNER_BACKEND === 'local')
    lines.push(
      '  - SIGNER_BACKEND: local keeps keys in memory and is refused in production',
    );
  // Unit/e2e must not depend on host chrony drift (WSL often has multi-second offset)
  if (env.NODE_ENV === 'test') env.CLOCK_QUALITY_SOURCE = 'stub';
  if (lines.length > 0)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  return env;
}
