# 018. Software Supply-Chain Compromise

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    poisonedPkg[Poisoned dependency or vendor UI] --> buildRuns[Install or the approval screen runs attacker code]
    buildRuns --> keysOut[Secrets and signing decisions leave the environment]
  end
  subgraph solutionPath [Recommended solution]
    pin["Exact versions, npm ci, lockfile committed"] --> review[Review install scripts and vendor diffs]
  end
```

## Problem

The application trusts its build. A malicious release of a transitive package, a tampered CI plugin, or a changed vendor UI runs with the permissions of the developer or the production task. From January 2025 through September 2026 this class of attack accounted for the largest share of recorded crypto-platform losses, including a multisig UI that showed operators a different transaction from the one they signed.

## Impact

- CI secrets and cloud tokens are exfiltrated during `npm install`.
- A dependency that runs on the server reads environment variables and the OpenBao token.
- Operators approve a withdrawal whose displayed destination is not the signed one.
- A lockfile that is not committed lets production resolve a different tree than the one that was reviewed.

## Recommended solution

`.npmrc` sets `save-exact=true` and `engine-strict=true`. Install with `npm ci` from the committed lockfile. Pin Docker image tags. Treat `install` and `postinstall` scripts as a review item, and check license, age, and audit before adding a package. Custody signing uses the canonical payload the server built, inside OpenBao or the KMS, so a compromised process cannot export the key and a tampered screen cannot swap the bytes. When an approver screen exists, it shows that same payload.

## Code

```mermaid
flowchart TD
  pin[".npmrc save-exact and engine-strict"] --> ci["Dockerfile runs npm ci"]
  ci --> lock["Install the committed lockfile"]
  sign["CustodySignerService.sign"] --> canon["Hash the canonical payload"]
  canon --> hsm["Signer.sign inside OpenBao or KMS"]
  payout["POST /v1/withdrawals"] -.-> gap["Does not call CustodySignerService"]
```

`.npmrc` is those two lines. Both Docker stages copy the lockfile and run `npm ci`. `CustodySignerService.sign` hashes the canonical payload and calls `Signer.sign`. The private key stays in OpenBao or KMS. Nothing in the withdrawal payout calls `CustodySignerService` yet, so that audit row is not written on today's `POST /v1/withdrawals`.

```
save-exact=true
engine-strict=true
```

```dockerfile
COPY package.json package-lock.json .npmrc ./
RUN npm ci
```

```typescript
const canonical = canonicalize(request.payload);
const bytes = Buffer.from(canonical, 'utf8');
const payloadHash = createHash('sha256').update(bytes).digest('hex');
const signature = await this.signer.sign(bytes, this.keyRef);
```
