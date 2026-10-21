# 003. Misuse of Cryptographic Primitives and Libraries

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    customAlg[Custom cipher or a deprecated hash] --> breakable[A practical attack recovers plaintext or forges a MAC]
  end
  subgraph solutionPath [Recommended solution]
    nodeCrypto[Node crypto and a named algorithm registry] --> knownConstructions["SHA-256 over canonical JSON, standard signatures"]
  end
```

## Problem

Teams pick MD5, SHA-1, or a hand-rolled cipher because it is short to write, or they call a solid library with the wrong construction. "Encryption" that is really Base64, and a MAC compared with `===`, are the same class of mistake. The algorithm looks present in a review and fails in an attack.

## Impact

- Forged audit hashes or webhook MACs that the server accepts.
- Collisions on identifiers that were only hashed, not keyed.
- A library upgrade that changes a default and silently weakens every new signature.
- No way to migrate later, because the artifact does not record which algorithm produced it.

## Recommended solution

Use Node `crypto` and the constructions already fixed for this platform: SHA-256 over canonical JSON (RFC 8785), detached signatures through the `Signer`, and `crypto.timingSafeEqual` for MAC and signature compares. Do not invent ciphers, modes, or paddings. Register allowed algorithms in one place and store `alg` on every artifact. Dependency review rejects packages whose only job is to wrap a deprecated hash.
