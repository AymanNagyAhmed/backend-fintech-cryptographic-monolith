# 013. Phishing and UI Spoofing

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    lookalike[Look-alike site or a tampered approval screen] --> userSigns[User approves the attacker's destination]
  end
  subgraph solutionPath [Recommended solution]
    canonical[Show the canonical amount and address] --> delay["Allow-list, delay, and a second approver"]
  end
```

## Problem

Users authorize what they see. A look-alike domain, a clickjacked button, a browser extension, or a vendor UI that was modified can show "pay Alice 10" while the signed payload pays someone else 10,000. This is the same failure mode as an operational signing screen that does not match the bytes.

## Impact

- The user authorizes a withdrawal to an attacker and the ledger is correct about a wrong intent.
- Support staff reset credentials because a deepfake or a copied site asked them to.
- Framed pages capture TOTP codes.
- A wallet extension swaps the recipient after the review screen.

## Recommended solution

Serve the app only from the real origin, with frame-ancestors locked down by Helmet. Withdrawals show the canonical address and decimal amount that will be signed, then wait out the custody delay. High-value sends require a second approver and an allow-listed destination. The server rejects a body that does not match that canonical form. Teach users the origin. Do not ask them to read a seed phrase into a web form.
