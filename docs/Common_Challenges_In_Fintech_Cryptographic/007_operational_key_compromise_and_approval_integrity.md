# 007. Operational Key Compromise and Approval Integrity

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    oneOperator[One operator approves what the UI shows] --> swapped[Vendor UI shows a different destination]
    swapped --> drained[Custodial wallet is drained]
  end
  subgraph solutionPath [Recommended solution]
    fourEyes["Allow-list, limits, delay, and four eyes"] --> auditedSign[Each signing request is audited inside the HSM path]
  end
```

## Problem

Most centralized-exchange losses come from a key that was used, not from a weak algorithm. One operator, a shared break-glass credential, or an approval screen supplied by a vendor is enough. In 2025 the largest exchange theft changed what operators saw on a multisig approval screen while the signed payload sent funds elsewhere.

## Impact

- A single phished operator moves the whole hot wallet.
- The audit log says "approved" and the on-chain transfer does not match the amount or address the operator read.
- A backup of the seed, stored in a chat or a ticket, is the key.
- There is no delay in which a second person can stop the withdrawal.

## Recommended solution

Custody withdrawals on this platform use non-exportable keys and enforce an address allow-list, amount limits, a delay, and four-eyes approval before the `Signer` is called. Every signing request is written to the append-only audit log. The approver confirms the canonical destination and amount, not a vendor-rendered summary alone. Seeds and private keys are not exported into the app database or into operator laptops.
