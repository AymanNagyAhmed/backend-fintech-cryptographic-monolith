# 024. PCI-DSS Compliance

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    storePan[Primary account number stored in the app database] --> scope[The whole platform enters card-data scope]
  end
  subgraph solutionPath [Recommended solution]
    token[Provider token and a signed webhook] --> noPan[No PAN or CVV in PostgreSQL or logs]
  end
```

## Problem

If the app sees a primary account number, PCI-DSS scope covers the systems that store, process, or transmit it. Logging the number, putting it in an audit hash, or keeping it "just for refunds" is enough to enter that scope. A webhook that says a card payment succeeded is not itself a license to store the card.

## Impact

- A database backup is a cardholder-data breach.
- Audit retention keeps the number for years.
- The assessment cost and the control set jump from a tokenized integration to the full card environment.
- A CVV stored beside the number fails the standard outright.

## Recommended solution

Take card payments through a provider (this platform verifies signed webhooks, starting with the Stripe secret). Persist the provider's charge id and a token, never the PAN or CVV. Redaction already strips secret-shaped fields before an audit payload is hashed. Keep the webhook secret in the environment, sealed the same way as other integration secrets, and rotate it with the provider. If a future feature must touch raw card data, isolate that process, its database, and its keys from the ledger app.
