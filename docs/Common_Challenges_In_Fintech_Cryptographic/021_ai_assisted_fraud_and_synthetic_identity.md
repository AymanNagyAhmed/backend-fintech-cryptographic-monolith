# 021. AI-Assisted Fraud and Synthetic Identity

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    deepfake[Deepfake KYC or a fake support call] --> opened[Account or payout approved for a synthetic person]
  end
  subgraph solutionPath [Recommended solution]
    vendorKyc[Vendor liveness plus sanctions screen] --> stepUp[Out-of-band step-up before the first large send]
  end
```

## Problem

Phishing and account opening now use generated faces, documents, and voice. Chainalysis's 2026 scam figures show operations linked on-chain to AI vendors taking about 4.5 times more per scam than operations without that link. The target is the KYC reviewer and the support queue, not only the password form.

## Impact

- A synthetic identity passes a document check and receives a limit.
- A support agent resets TOTP after a convincing call.
- A mule account stays under automated thresholds and cashes out through many small withdrawals.
- Chargebacks and sanctions exposure land on the platform after the funds have settled.

## Recommended solution

Gate money movement on a KYC vendor decision that includes liveness, and on sanctions screening, not on a document image alone. The first withdrawal above the limit requires TOTP step-up and the custody delay. MFA reset and limit changes are audited admin actions with four eyes. Train support to verify a callback to a number already on the account. Rate limits and device signals still apply. The model that scores risk is an input to a human or to a hard rule. It is not the only approver.

## Code

```mermaid
flowchart TD
  login["Login"] --> enabled{"TOTP enabled?"}
  enabled -->|no| session["Create the session"]
  enabled -->|yes| code{"code verifies?"}
  code -->|no| deny["invalidTotp"]
  code -->|yes| session
  wd["Withdrawal"] --> step{"a new TOTP code verifies?"}
  step -->|no| stop["INVALID_TOTP, no ledger post"]
  step -->|yes| post["requireActive, then ledger.post"]
  priv["Privileged route"] --> mfa{"session passed TOTP?"}
  mfa -->|no| need["mfaRequired"]
```

There is no KYC vendor call, no sanctions screen, and no MFA-reset route in this repository. The step-up that is implemented is TOTP. Login verifies the code when TOTP is enabled, before a session is created. `POST /v1/withdrawals` verifies a new code before `requireActive` and `ledger.post`. `RolesGuard` refuses a privileged role when the session did not pass TOTP.

```typescript
const mfa = await this.totp.isEnabled(user.id);
if (mfa) {
  if (!dto.totpCode) throw totpRequired();
  if (!(await this.totp.verify(user.id, dto.totpCode))) throw invalidTotp();
}
```

```typescript
if (!(await this.totp.verify(userId, dto.totpCode))) throw invalidTotp();
```

```typescript
if (!user.mfa && granted.every((role) => PRIVILEGED_ROLES.includes(role)))
  throw mfaRequired();
```
