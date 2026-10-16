// Rotates the configured OpenBao Transit signing key and publishes any missing
// public key versions into crypto.signing_keys (A-B8.5 / make rotate-key):
//   npm run rotate:key
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OpenBaoTransitSigner } from '../src/modules/crypto/adapters/openbao-transit.signer.js';
import { KeyRotationService } from '../src/modules/crypto/key-rotation.service.js';
import { SigningKeysService } from '../src/modules/crypto/signing-keys.service.js';

process.loadEnvFile(new URL('../.env', import.meta.url));
const env = validate(process.env);
const config = {
  get: (key: keyof EnvironmentVariables) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;
const prisma = new PrismaService(config);
const keyRef = env.SIGNING_KEY_NAME;

try {
  const rotation = new KeyRotationService(
    new OpenBaoTransitSigner(env.BAO_ADDR, env.BAO_TOKEN),
    new SigningKeysService(prisma),
  );
  const result = await rotation.rotate(keyRef);
  console.log(JSON.stringify(result, null, 2));
  console.error(
    `Rotated ${result.keyRef} to v${result.latestVersion} (${result.alg}); ` +
      `published ${result.published.length} new catalog row(s)`,
  );
} finally {
  await prisma.$disconnect();
}
