import { createHash } from 'node:crypto';
import { canonicalJson } from '../../common/crypto/canonical-json.js';
import { GENESIS_PREV_HASH, chainHash } from './chain-hash.js';

describe('chainHash', () => {
  const payload = {
    type: 'transfer.completed',
    schemaVersion: 1,
    amount: '1.00',
  };

  it('hashes prev_hash bytes then canonical JSON (order-stable)', () => {
    const expected = createHash('sha256')
      .update(Buffer.from(GENESIS_PREV_HASH, 'hex'))
      .update(
        canonicalJson({
          amount: '1.00',
          schemaVersion: 1,
          type: 'transfer.completed',
        }),
        'utf8',
      )
      .digest('hex');
    expect(chainHash(GENESIS_PREV_HASH, payload)).toBe(expected);
    expect(
      chainHash(GENESIS_PREV_HASH, {
        amount: '1.00',
        type: 'transfer.completed',
        schemaVersion: 1,
      }),
    ).toBe(expected);
  });

  it('changes when the previous hash changes', () => {
    const a = chainHash(GENESIS_PREV_HASH, payload);
    const b = chainHash(a, payload);
    expect(b).not.toBe(a);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a non-hex prevHash', () => {
    expect(() => chainHash('zz', payload)).toThrow(/prevHash/);
  });
});
