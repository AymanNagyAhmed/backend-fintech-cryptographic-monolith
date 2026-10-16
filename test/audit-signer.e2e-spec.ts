import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenBaoTransitSigner } from '../src/modules/crypto/adapters/openbao-transit.signer.js';
import { KeyStoreException } from '../src/modules/crypto/exceptions/key-store.exception.js';

process.loadEnvFile(new URL('../.env', import.meta.url));

/**
 * Separation of duties (A-B8.8 / 2.6): the `audit-signer` policy may sign and
 * read the public key of SIGNING_KEY_NAME, but must not rotate that key.
 * Needs Compose OpenBao with Transit enabled (A-B1.9) and BAO_TOKEN = root.
 */
describe('OpenBao audit-signer policy (e2e)', () => {
  const addr = (process.env.BAO_ADDR ?? '').replace(/\/$/, '');
  const rootToken = process.env.BAO_TOKEN ?? '';
  const keyRef = process.env.SIGNING_KEY_NAME ?? 'audit-signing';
  const root = fileURLToPath(new URL('..', import.meta.url));
  const committedPolicy = readFileSync(
    resolve(root, 'openbao/policies/audit-signer.hcl'),
    'utf8',
  );
  const policyForKey = committedPolicy.replaceAll('audit-signing', keyRef);
  let signerToken = '';

  const bao = async (
    method: string,
    path: string,
    body?: unknown,
    token = rootToken,
  ) => {
    const res = await fetch(`${addr}/v1/${path}`, {
      method,
      headers: {
        'X-Vault-Token': token,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text
      ? (JSON.parse(text) as {
          errors?: string[];
          data?: Record<string, unknown>;
          auth?: { client_token?: string };
        })
      : {};
    if (!res.ok) {
      const detail = json.errors?.join('; ') || text || res.statusText;
      throw new Error(`${method} ${path}: HTTP ${res.status}: ${detail}`);
    }
    return json;
  };

  beforeAll(async () => {
    // Ensure the Transit key exists (A-B1.9); ignore "already enabled" / exists.
    try {
      await bao('POST', 'sys/mounts/transit', { type: 'transit' });
    } catch {
      /* mount may already exist */
    }
    try {
      await bao('POST', `transit/keys/${keyRef}`, {
        type: 'ed25519',
        exportable: false,
      });
    } catch {
      /* key may already exist */
    }

    await bao('PUT', 'sys/policies/acl/audit-signer', {
      policy: policyForKey,
    });
    const created = await bao('POST', 'auth/token/create-orphan', {
      policies: ['audit-signer'],
      display_name: 'e2e-audit-signer',
      ttl: '1h',
    });
    signerToken = created.auth?.client_token ?? '';
    if (!signerToken) throw new Error('failed to create audit-signer token');
  });

  afterAll(async () => {
    if (!signerToken) return;
    try {
      await bao('POST', 'auth/token/revoke', { token: signerToken });
    } catch {
      /* ignore */
    }
  });

  it('committed policy only allows sign and read on the signing key', () => {
    expect(committedPolicy).toMatch(/transit\/sign\/audit-signing/);
    expect(committedPolicy).toMatch(/transit\/keys\/audit-signing/);
    expect(committedPolicy).not.toMatch(/transit\/keys\/audit-signing\/rotate/);
    expect(committedPolicy).toMatch(/capabilities = \["update"\]/);
    expect(committedPolicy).toMatch(/capabilities = \["read"\]/);
  });

  it('audit-signer token can sign and verify; cannot rotate', async () => {
    const signer = new OpenBaoTransitSigner(addr, signerToken);
    const message = new TextEncoder().encode('checkpoint-separation-of-duties');
    const envelope = await signer.sign(message, keyRef);
    expect(envelope.keyId).toMatch(new RegExp(`^${keyRef}:v\\d+$`));
    expect(await signer.verify(message, envelope)).toBe(true);

    await expect(signer.rotate(keyRef)).rejects.toBeInstanceOf(
      KeyStoreException,
    );
  });
});
