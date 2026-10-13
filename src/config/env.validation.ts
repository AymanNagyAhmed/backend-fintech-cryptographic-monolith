import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
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
const LOCAL_URL = { require_tld: false, require_protocol: true };

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const SIGNING_ALGS = ['ed25519', 'ecdsa-p256', 'ml-dsa-65'] as const;

export class EnvironmentVariables {
  @IsIn(NODE_ENVS)
  NODE_ENV: (typeof NODE_ENVS)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @Matches(/^postgres(ql)?:\/\/.+/, { message: '$property must be a postgresql:// URL' })
  DATABASE_URL: string;

  @Matches(/^postgres(ql)?:\/\/.+/, { message: '$property must be a postgresql:// URL' })
  MIGRATOR_DATABASE_URL: string;

  @Matches(/^rediss?:\/\/.+/, { message: '$property must be a redis:// or rediss:// URL' })
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
  @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: '$property must be 32 bytes, base64 (openssl rand -base64 32)' })
  TOTP_ENCRYPTION_KEY: string;

  // AES-256-GCM key for B2B HMAC secrets at rest (auth.api_clients); separate from the TOTP key
  @Matches(/^[A-Za-z0-9+/]{43}=$/, { message: '$property must be 32 bytes, base64 (openssl rand -base64 32)' })
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

  @IsString()
  @MinLength(32)
  @NotEquals(PLACEHOLDER)
  WEBHOOK_SECRET_STRIPE: string;

  @IsUrl(LOCAL_URL)
  BAO_ADDR: string;

  @IsString()
  @MinLength(16)
  @NotEquals(PLACEHOLDER)
  BAO_TOKEN: string;

  @IsString()
  @IsNotEmpty()
  SIGNING_KEY_NAME: string;

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
}

// Error text names the variable and the rule only; values are never echoed because they may be secrets.
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return env;
}
