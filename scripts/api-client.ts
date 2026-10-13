// Creates or revokes a B2B API client (auth.api_clients). Run as app_writer from .env:
//   npm run api-client -- create --id dev-client --name "Dev client" --alg hmac_sha256
//   npm run api-client -- create --id partner-x --name "Partner X" --alg ed25519 --generate-key partner-x.pem
//   npm run api-client -- create --id partner-y --name "Partner Y" --alg ed25519 --public-key partner-y.pub.pem
//   npm run api-client -- revoke --id dev-client
// The HMAC secret and a generated private key are shown or written once; the server keeps
// only the sealed secret or the public key.
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  API_SIGNING_ALGORITHMS,
  ApiClientsService,
  type ApiSigningAlgorithm,
} from '../src/modules/auth/api-clients/api-clients.service.js';

const usage =
  'usage: api-client create --id <id> --name <name> --alg hmac_sha256|ed25519 [--public-key <pem> | --generate-key <out.pem>] | revoke --id <id>';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    alg: { type: 'string' },
    'public-key': { type: 'string' },
    'generate-key': { type: 'string' },
  },
});
const [command] = positionals;
if (!values.id || (command !== 'create' && command !== 'revoke')) {
  console.error(usage);
  process.exit(2);
}

process.loadEnvFile(new URL('../.env', import.meta.url));
const env = validate(process.env);
const config = {
  get: (key: keyof EnvironmentVariables) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;
const prisma = new PrismaService(config);
const clients = new ApiClientsService(prisma, config);

function ed25519PublicKey(): KeyObject {
  if (values['public-key'])
    return createPublicKey(readFileSync(values['public-key']));
  if (values['generate-key']) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(
      values['generate-key'],
      privateKey.export({ format: 'pem', type: 'pkcs8' }),
      { mode: 0o600, flag: 'wx' },
    );
    console.error(
      `Private key written to ${values['generate-key']} (mode 600); keep it secret.`,
    );
    return publicKey;
  }
  throw new Error(
    'ed25519 needs --public-key <pem> or --generate-key <out.pem>',
  );
}

try {
  if (command === 'revoke') {
    const revoked = await clients.revoke(values.id);
    console.log(
      revoked
        ? `Revoked ${values.id}`
        : `${values.id}: unknown or already revoked`,
    );
    process.exitCode = revoked ? 0 : 1;
  } else {
    const alg = values.alg as ApiSigningAlgorithm;
    if (!API_SIGNING_ALGORITHMS.includes(alg) || !values.name) {
      console.error(usage);
      process.exit(2);
    }
    const created =
      alg === 'hmac_sha256'
        ? await clients.create({
            clientId: values.id,
            name: values.name,
            algorithm: alg,
          })
        : await clients.create({
            clientId: values.id,
            name: values.name,
            algorithm: alg,
            publicKey: ed25519PublicKey(),
          });
    console.log(
      `Created ${created.clientId} (${created.algorithm}, id ${created.id})`,
    );
    if (created.secret)
      console.log(
        `Secret (shown once, store it in the client's secret store):\n${created.secret}`,
      );
  }
} finally {
  await prisma.$disconnect();
}
