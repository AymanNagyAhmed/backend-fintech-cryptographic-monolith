import { SIGNING_ALGS } from '../../config/env.validation.js';
import {
  ALGORITHM_REGISTRY,
  algorithmOf,
  isSigningAlg,
} from './algorithm-registry.js';
import type { SigningAlg } from './signer.js';

describe('algorithm registry', () => {
  it('registers every configured SIGNING_ALGS entry and nothing else', () => {
    expect(Object.keys(ALGORITHM_REGISTRY).sort()).toEqual(
      [...SIGNING_ALGS].sort(),
    );
  });

  it.each(SIGNING_ALGS)('isSigningAlg accepts %s', (alg) => {
    expect(isSigningAlg(alg)).toBe(true);
  });

  it('isSigningAlg rejects unknown names', () => {
    expect(isSigningAlg('rsa-2048')).toBe(false);
    expect(isSigningAlg('ED25519')).toBe(false);
    expect(isSigningAlg(null)).toBe(false);
  });

  it.each<[SigningAlg, 'sha256' | null]>([
    ['ed25519', null],
    ['ecdsa-p256', 'sha256'],
    ['ml-dsa-65', null],
  ])('%s uses digest %s', (alg, digest) => {
    expect(algorithmOf(alg).digest).toBe(digest);
  });

  it('keeps fixed signature lengths for Ed25519 and ML-DSA-65', () => {
    expect(algorithmOf('ed25519').signatureBytes).toEqual({
      min: 64,
      max: 64,
    });
    expect(algorithmOf('ml-dsa-65').signatureBytes).toEqual({
      min: 3309,
      max: 3309,
    });
  });

  it('allows the DER length range for ECDSA P-256', () => {
    const { min, max } = algorithmOf('ecdsa-p256').signatureBytes;
    expect(min).toBeLessThanOrEqual(max);
    expect(min).toBeGreaterThan(0);
  });
});
