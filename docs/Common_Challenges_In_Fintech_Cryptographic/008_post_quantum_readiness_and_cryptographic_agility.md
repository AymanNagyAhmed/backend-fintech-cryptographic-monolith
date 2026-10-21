# 008. Post-Quantum Readiness and Cryptographic Agility

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    rsaOnly["Only RSA or ECC, algorithm unnamed"] --> harvest[Recorded key exchange decrypted later]
  end
  subgraph solutionPath [Recommended solution]
    hybrid[Hybrid TLS on the prod Nginx profile] --> localEd["Local signing stays ed25519; alg stored on the artifact"]
  end
```

## Problem

A cryptographically relevant quantum computer has not broken production fintech systems. Someone who records today's public-key traffic can keep it until one does. Systems that hard-code RSA or a single curve, and that do not store which algorithm signed an artifact, cannot migrate without a rewrite. The March 2026 European Payments Council guidelines treat that migration as design work to do now.

## Impact

- Long-lived secrets (card data, identity documents, signed instructions) become readable when the recorded key exchange falls.
- Historical signatures cannot be re-verified under a new algorithm because `alg` was never stored.
- A rushed cutover breaks verification of old checkpoints.
- Teams discover the inventory of algorithms only during an incident.

## Recommended solution

Keep a cryptographic bill of materials. Every signature stores `alg` and `keyId`, and verification accepts the algorithm the artifact names, so old checkpoints stay verifiable. Local signing stays ed25519: OpenBao 2.7 Transit cannot sign ML-DSA, and the signer must not claim a signature that key store did not create. ML-DSA stays in the registry for a later key store. Edge TLS on the production Nginx profile is hybrid, X25519 together with ML-KEM. The local dev server does not serve that profile.
