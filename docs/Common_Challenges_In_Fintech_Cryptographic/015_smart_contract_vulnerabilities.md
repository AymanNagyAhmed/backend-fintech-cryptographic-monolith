# 015. Smart Contract Vulnerabilities

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    customContract[Unaudited contract holds user funds] --> drained["Reentrancy, overflow, or ordering drains it"]
  end
  subgraph solutionPath [Recommended solution]
    custodial[This platform keeps balances in the ledger] --> noContract[No contract in the money path]
  end
```

## Problem

Reentrancy, integer overflow, and transaction-ordering attacks drain contracts that hold balances. They dominate losses on decentralized apps. They are not a property of a custodial web app that never deploys a contract. Adding one "just for deposits" pulls the whole class of bugs into the product.

## Impact

- Every user balance locked in the contract can leave in one transaction.
- A front-run changes the price or the recipient the user thought they accepted.
- The web app cannot reverse the chain transaction, so the ledger and the chain disagree.
- An upgrade key on the contract is a second custody key with weaker controls than the HSM.

## Recommended solution

This modular monolith records balances in the double-entry ledger and signs with OpenBao or a KMS. It does not put user funds in a contract. If a later product must talk to a chain, treat the contract as a new custody system: an external audit, explicit pause, upgrade keys in an HSM with four-eyes, and integer arithmetic in the contract's own units. The web tier still checks authorization, idempotency, and the ledger. It does not assume the contract is safe because the UI is.
