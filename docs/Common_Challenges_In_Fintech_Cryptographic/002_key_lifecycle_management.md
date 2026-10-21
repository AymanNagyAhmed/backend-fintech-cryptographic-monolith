# 002. Key Lifecycle Management

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    oneKey[One key forever] --> stolenOrExpired[Compromise or a forced retirement]
    stolenOrExpired --> unverifiable[Old checkpoints no longer verify]
  end
  subgraph solutionPath [Recommended solution]
    versioned[alg plus keyId and version on every artifact] --> overlap[New version signs while the old one still verifies]
    overlap --> revoke[revokedAt rejects later signatures]
  end
```

## Problem

Keys have to rotate and, when compromised, be revoked. A rotation that deletes the old key makes historical signed tree heads and payment records unverifiable. A rotation that keeps accepting the old key after revocation leaves a stolen key useful. Re-encrypting data under a new key during a live request path stalls users.

## Impact

- Users and regulators cannot prove an old audit head was signed by us.
- A revoked key still accepted after `revokedAt` keeps authorizing fraud.
- A big-bang re-encryption locks accounts for the length of the job.
- Dual-running two algorithms without a version on the artifact makes verifiers guess, and guess wrong.

## Recommended solution

Every signed artifact stores `alg` (for example `ed25519` or `ml-dsa-65`) and `keyId` including the key version. Rotation publishes a new version and signs new artifacts with it. Verification uses the public key of the exact version named on the artifact, so old checkpoints stay valid. If `revokedAt` is set, verification returns false for signatures after that time and still accepts earlier ones when an external time anchor covers them. Re-encryption of data keys runs as a background job, not on the request that the user is waiting on.

## Code

```mermaid
flowchart TD
  verify["SignerService.verify"] --> outcome["signatureOutcome"]
  outcome --> revoked{"revokedAt set?"}
  revoked -->|no| adapter["backend.verify"]
  revoked -->|yes| cover{"anchored and signedAt before revokedAt?"}
  cover -->|yes| adapter
  cover -->|no| falseRevoked["reason revoked, verify returns false"]
  adapter -->|match| ok["return true"]
  adapter -->|no match| falseOther["return false"]
```

A live check passes no time argument, so a key with `revokedAt` set returns `{ ok: false, reason: 'revoked' }` and `verify` returns false. The tamper check `signatureOk` passes `signedAt` from the stored tree head and `anchored` from `storedTsaToken`. The adapter runs only when that token is stored and `signedAt` is strictly before `revokedAt`. A signature at or after `revokedAt`, or one whose token is still missing, is `revoked` and `verify` returns false.

```typescript
export interface AnchoredSignature {
  signedAt: Date;
  anchored: boolean;
}
```

```typescript
function coveredBeforeRevocation(
  revokedAtIso: string,
  anchor: AnchoredSignature | undefined,
): boolean {
  if (anchor?.anchored !== true || !(anchor.signedAt instanceof Date))
    return false;
  const signedAt = anchor.signedAt.getTime();
  const revokedAt = new Date(revokedAtIso).getTime();
  if (Number.isNaN(signedAt) || Number.isNaN(revokedAt)) return false;
  return signedAt < revokedAt;
}
```

```typescript
if (
  published?.revokedAt != null &&
  !coveredBeforeRevocation(published.revokedAt, anchor)
)
  return { ok: false, reason: 'revoked', keyId: envelope.keyId };
if ((await this.backend.verify(bytes, envelope)) === true)
  return { ok: true };
```

```typescript
signer.verify(
  sthCanonicalBytes({
    treeSize: head.treeSize,
    rootHash: head.rootHash,
    timestamp: head.timestamp.toISOString(),
    previousSthHash: head.previousSthHash,
  }),
  { alg: head.alg as 'ed25519', keyId: head.keyId, sig: head.signature },
  { signedAt: head.timestamp, anchored: storedTsaToken(head.tsaToken) },
);
```
