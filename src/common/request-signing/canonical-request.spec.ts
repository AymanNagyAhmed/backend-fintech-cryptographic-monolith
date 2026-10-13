import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import {
  canonicalRequest,
  NONCE_PATTERN,
  NONCE_TTL_SEC,
  SIGNATURE_WINDOW_SEC,
  signRequestHeaders,
} from './canonical-request.js';

const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('canonical request', () => {
  const parts = {
    method: 'post',
    path: '/v1/b2b/ping?x=1',
    timestamp: '1760371200',
    nonce: 'n0nce-0123456789ab',
    body: '{"message":"hi"}',
  };

  it('joins method, path, timestamp, nonce and the body hash with newlines', () => {
    expect(canonicalRequest(parts)).toBe(
      [
        'POST',
        '/v1/b2b/ping?x=1',
        '1760371200',
        'n0nce-0123456789ab',
        // printf '%s' '{"message":"hi"}' | sha256sum
        'adbd982b8fe0bbd8477f09262028d3ac264001dc36e3c7579905e72c0b718755',
      ].join('\n'),
    );
  });

  it('hashes an empty body as sha256 of no bytes', () => {
    expect(canonicalRequest({ ...parts, body: Buffer.alloc(0) })).toMatch(
      new RegExp(`\\n${EMPTY_SHA256}$`),
    );
  });

  it('changes when any single part changes', () => {
    const base = canonicalRequest(parts);
    for (const change of [
      { method: 'GET' },
      { path: '/v1/b2b/ping?x=2' },
      { timestamp: '1760371201' },
      { nonce: 'n0nce-0123456789ac' },
      { body: '{"message":"hj"}' },
    ])
      expect(canonicalRequest({ ...parts, ...change })).not.toBe(base);
  });

  it('keeps nonces until the time window has passed for every accepted timestamp', () => {
    expect(NONCE_TTL_SEC).toBeGreaterThanOrEqual(2 * SIGNATURE_WINDOW_SEC);
  });

  it('signs with HMAC-SHA256 over the canonical string, keyed by the secret string', () => {
    const headers = signRequestHeaders({
      ...parts,
      clientId: 'dev-client',
      key: 'b2b_secret',
    });
    expect(headers).toEqual({
      'x-client-id': 'dev-client',
      'x-timestamp': parts.timestamp,
      'x-nonce': parts.nonce,
      'x-signature': createHmac('sha256', 'b2b_secret')
        .update(canonicalRequest(parts))
        .digest('base64'),
    });
  });

  it('signs with Ed25519 and makes a fresh timestamp and a valid nonce by default', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const { path, method, body } = parts;
    const headers = signRequestHeaders({
      clientId: 'p-x',
      key: privateKey,
      path,
      method,
      body,
    });
    expect(NONCE_PATTERN.test(headers['x-nonce'])).toBe(true);
    expect(
      Math.abs(Number(headers['x-timestamp']) - Date.now() / 1000),
    ).toBeLessThan(5);
    const canonical = canonicalRequest({
      ...parts,
      timestamp: headers['x-timestamp'],
      nonce: headers['x-nonce'],
    });
    expect(
      verify(
        null,
        Buffer.from(canonical),
        publicKey,
        Buffer.from(headers['x-signature'], 'base64'),
      ),
    ).toBe(true);
  });
});
