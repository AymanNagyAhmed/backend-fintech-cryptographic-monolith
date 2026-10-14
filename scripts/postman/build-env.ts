// Writes the git-ignored postman/environments/<name>.local.postman_environment.json: the
// committed <name>.postman_environment.json with its secret values filled from the .env files.
//   npm run postman:env [-- --env-name dev]
// Run again after changing .env. Secrets missing from .env stay empty (and are listed).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv, parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    'env-name': { type: 'string', default: 'dev' },
    dir: { type: 'string', default: 'postman/environments' },
  },
});

/** Postman secret variable -> .env key. Add a line when a request needs a new secret. */
const SECRETS_FROM_ENV: Record<string, string> = {
  b2bSecret: 'B2B_DEV_SECRET',
  webhookSecretStripe: 'WEBHOOK_SECRET_STRIPE',
};

/** Postman variable -> .env key that replaces the committed value only when it is set. */
const OVERRIDES_FROM_ENV: Record<string, string> = {
  userPassword: 'SEED_USER_PASSWORD',
};

/** Backend .env first, then the Compose .env one level up. */
const ENV_FILES = ['.env', '../.env'];

interface EnvironmentFile {
  id: string;
  name: string;
  values: { key: string; value: string; type: string; enabled: boolean }[];
  [key: string]: unknown;
}

const dotenv: Record<string, string | undefined> = Object.assign(
  {},
  ...ENV_FILES.filter(existsSync)
    .reverse()
    .map((f) => parseEnv(readFileSync(f, 'utf8'))),
);

const source = `${args.dir}/${args['env-name']}.postman_environment.json`;
const target = `${args.dir}/${args['env-name']}.local.postman_environment.json`;
const env = JSON.parse(readFileSync(source, 'utf8')) as EnvironmentFile;

const committedSecrets = env.values.filter(
  (v) => v.type === 'secret' && v.value !== '',
);
if (committedSecrets.length > 0) {
  console.error(
    `${source} must not contain secret values: ${committedSecrets.map((v) => v.key).join(', ')}`,
  );
  process.exit(1);
}

const missing: string[] = [];
const local: EnvironmentFile = {
  ...env,
  name: `${env.name} (local)`,
  values: env.values.map((v) => {
    const override = dotenv[OVERRIDES_FROM_ENV[v.key] ?? ''];
    if (override) return { ...v, value: override };
    const envKey = SECRETS_FROM_ENV[v.key];
    if (!envKey) return v;
    const value = dotenv[envKey];
    if (!value) missing.push(`${v.key} (${envKey})`);
    return { ...v, value: value ?? '' };
  }),
};

writeFileSync(target, `${JSON.stringify(local, null, 2)}\n`, { mode: 0o600 });
console.log(
  `${target}: ${local.values.length} variables` +
    (missing.length ? `; not in .env: ${missing.join(', ')}` : ''),
);
