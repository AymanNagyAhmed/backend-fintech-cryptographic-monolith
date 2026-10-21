# 020. Security Logging and Alerting Failures

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    editableLog[Logs that can be updated or that omit key use] --> blind[Fraud and a bad signature leave no trail]
  end
  subgraph solutionPath [Recommended solution]
    appendOnly[Append-only audit chain plus WORM copy] --> alert[Prometheus alerts on verify failures and clock skew]
  end
```

## Problem

A control that nobody hears fail is not a control. Missing logs of failed signature checks, key use, withdrawal-limit hits, and admin exports mean the first sign of fraud is a customer. A log that the app role can `UPDATE`, or that contains full PANs and secrets, fails the investigation and the privacy review at once.

## Impact

- A revoked key keeps being presented and nobody is paged.
- An investigator cannot show which withdrawal was approved by whom.
- Secrets written into the log become permanent once the log is hashed.
- A superuser edit of the audit table hides the original event.

## Recommended solution

Business actions write an outbox row in the same transaction, and a worker appends hash-chained audit events. The app role has `SELECT` and `INSERT` on audit, not `UPDATE` or `DELETE`. Signed tree heads are copied to S3 Object Lock. Redaction drops secret and PII fields before the payload is hashed. Pino carries a request id. Prometheus alerts already cover audit failures and clock offset. Page a human on verify failures, withdrawal limit breaches, and refresh-token reuse.
