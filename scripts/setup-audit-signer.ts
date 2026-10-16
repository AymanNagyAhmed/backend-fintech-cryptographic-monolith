/**
 * Writes the OpenBao ACL policy `audit-signer` and creates an orphan token that
 * can only sign (and read the public key of) `SIGNING_KEY_NAME` (A-B8.8).
 *
 *   npm run openbao:setup-audit-signer
 *
 * Uses BAO_ADMIN_TOKEN if set, otherwise BAO_TOKEN (must be a root / policy-admin
 * token). Prints the new token once; put it in BAO_TOKEN for the Nest app and
 * keep the admin token in BAO_ADMIN_TOKEN for `make rotate-key`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';

process.loadEnvFile(new URL('../.env', import.meta.url));
const env: EnvironmentVariables = validate(process.env);

const root = fileURLToPath(new URL('..', import.meta.url));
const policyPath = resolve(root, 'openbao/policies/audit-signer.hcl');
const keyName = env.SIGNING_KEY_NAME;
const adminToken = env.BAO_ADMIN_TOKEN?.trim() || env.BAO_TOKEN;
const addr = env.BAO_ADDR.replace(/\/$/, '');

/** Render the committed policy with the configured signing key name. */
function policyFor(key: string): string {
  const template = readFileSync(policyPath, 'utf8');
  return template.replaceAll('audit-signing', key);
}

async function bao(
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${addr}/v1/${path}`, {
    method,
    headers: {
      'X-Vault-Token': adminToken,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text
    ? (JSON.parse(text) as {
        errors?: string[];
        data?: Record<string, unknown>;
        auth?: Record<string, unknown>;
      })
    : {};
  if (!res.ok) {
    const detail = json.errors?.join('; ') || text || res.statusText;
    throw new Error(`${method} ${path}: HTTP ${res.status}: ${detail}`);
  }
  return (json.data ?? json.auth ?? json) as Record<string, unknown>;
}

const policy = policyFor(keyName);
await bao('PUT', `sys/policies/acl/audit-signer`, { policy });

const auth = await bao('POST', 'auth/token/create-orphan', {
  policies: ['audit-signer'],
  display_name: 'audit-signer',
  renewable: true,
  ttl: '768h',
  meta: { purpose: 'checkpoint-sign', key: keyName },
});

const clientToken = auth.client_token;
if (typeof clientToken !== 'string' || clientToken.length < 16)
  throw new Error('OpenBao did not return a client_token');

console.log(
  JSON.stringify(
    {
      policy: 'audit-signer',
      keyName,
      tokenAccessor: auth.accessor ?? null,
      // Printed once; store as BAO_TOKEN for the app (never commit).
      BAO_TOKEN: clientToken,
    },
    null,
    2,
  ),
);
console.error(
  `Wrote policy audit-signer for transit key ${keyName}. ` +
    `Set BAO_TOKEN to the printed token and BAO_ADMIN_TOKEN to the root/admin token for rotate-key.`,
);
