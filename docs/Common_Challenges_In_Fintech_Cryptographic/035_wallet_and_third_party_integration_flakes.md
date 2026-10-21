# 035. Wallet and Third-Party Integration Flakes

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    hungCall[Provider call hangs or changes its payload] --> unknown[User and ledger disagree about the result]
  end
  subgraph solutionPath [Recommended solution]
    timeout[Bounded timeout and a stored pending state] --> retry["Idempotent retry, circuit open when the vendor is dead"]
  end
```

## Problem

Bank APIs, KYC vendors, and Web3 wallets drop connections, change fields, and return errors the client did not map. Wallet-connection flakes (MetaMask, WalletConnect) apply only when the product uses those wallets. Bank, card, and KYC failures apply to almost every fintech web app. Treating a timeout as "it failed" and also as "it succeeded" is how duplicate payouts start.

## Impact

- A user submits the payment again because the spinner never ended.
- A changed provider field is ignored and a deposit is never credited.
- One dead vendor occupies all outbound connections.
- The ledger has no row, so support cannot replay or refund from a record.

## Recommended solution

Persist the intent as `pending` before the outbound call. Bound the timeout. Map unknown responses to `pending`, not to success, and reconcile from the provider's own record. Retries use the idempotency key from [030. Idempotency of money movement](030_idempotency_of_money_movement.md). When the vendor stays down, open the circuit (the stage-2 gateway uses `opossum`) and fail closed for new payouts. Web3 wallet sessions, if added, are a client concern: the server still accepts only a verified signature over the canonical body.
