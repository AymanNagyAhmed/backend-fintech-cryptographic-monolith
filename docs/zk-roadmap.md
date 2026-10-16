# ZK proofs and selective disclosure roadmap

Current proof-of-reserves (A-B13) publishes a Merkle-sum tree: each client can
verify inclusion of their salted balance without learning other clients'
balances. That is privacy-preserving for **membership**, not for
**arbitrary predicates**.

## Near term (keep Merkle-sum)

- Daily published root + total liabilities
- Client-side verification of leaf + path (`GET /v1/reserves/proof/me`)
- Compare liabilities to custodian / on-chain reserves figures

## Medium term — ZK proofs

| Claim | Approach | Notes |
| --- | --- | --- |
| "My balance ≥ X" without revealing balance | zk-SNARK / STARK over the salted leaf | Prover knows salt + balance; verifier checks against published root |
| "Liabilities ≤ reserves" aggregate | Circuit over sum of leaves or recursive proofs | Complements the on-chain / custodian figure |
| "I am KYC-verified" | Credential + selective disclosure | Prefer SD-JWT / W3C VC over embedding PII in the tree |

Libraries and proving systems are not pinned yet; evaluate Circom/snarkjs,
Risc0, or Halo2 against audit and key-ceremony requirements (2.7, 2.14).

## Selective disclosure (SD-JWT)

For compliance and partner integrations:

1. Issue SD-JWT credentials for KYC attributes (jurisdiction, risk tier)
2. Present only the digests needed for a withdrawal or B2B call
3. Keep plaintext PII in Transit-sealed subject keys (A-B11); never in audit leaves

## Out of scope for the monolith milestone

- Full MPC ceremony (documented in `docs/custody-mpc.md`)
- On-chain settlement of the reserves root
- Zero-knowledge KYC shared with every venue connector
