# Custody signing: MPC / threshold as production target

## Current (monolith / A-B13)

`CustodySignerService` signs withdrawal payloads through the existing `Signer`
port (`SignerService`):

- **Dev:** OpenBao Transit with non-exportable private keys
- **Prod path:** AWS KMS (CMK, no plaintext export)
- Every `sign` emits a `custody.sign` audit event (payload hash, key id, alg)

Private key material never enters the Nest process.

## Production target

For digital-asset venues, a single HSM/KMS key holder is an unacceptable
single point of compromise. Production custody should move to:

1. **MPC / threshold signatures** (e.g. 2-of-3 or 3-of-5) so no single party
   ever holds a complete private key
2. **Policy co-signing** in the MPC ceremony (limits, allow-list, four-eyes
   already enforced in-app before the ceremony starts)
3. **Cold / warm key shards** with air-gapped or offline approval for large
   amounts (see hot/cold share config in A-B13.4)

The `Signer` interface stays the same; an MPC adapter replaces Transit/KMS
behind `SIGNER_BACKEND` (or a dedicated `CUSTODY_SIGNER_BACKEND`) without
changing withdrawal orchestration.

## Interview talking points (2.16)

- Non-exportable keys today; MPC tomorrow
- Allow-list + delay + four-eyes before any signing request is issued
- Full audit of every signing request (`custody.sign`)
