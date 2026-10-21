# 019. Bots, Credential Stuffing, and Rate Limits

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    openLogin[Unlimited login and payout attempts] --> stuffed[Stolen passwords and scripted withdrawals succeed]
  end
  subgraph solutionPath [Recommended solution]
    redisLimit["Redis throttler, fails closed"] --> tighter[Stricter limits on auth and money routes]
  end
```

## Problem

Login, password reset, quotes, and payouts are automated targets. Session design and TOTP do not slow a botnet that tries millions of passwords or that hammers a withdrawal route with a stolen token. A rate limiter that fails open when Redis is down removes the control at the moment of an incident.

## Impact

- Credential stuffing takes over accounts whose passwords were reused.
- A scripted client drains a balance in many small withdrawals under the human review threshold.
- One tenant generates enough traffic to slow transfers for everyone.
- Health checks get throttled and the orchestrator restarts a healthy app, or the opposite: money routes share the unlimited health budget.

## Recommended solution

`@nestjs/throttler` stores counters in Redis. The check-and-block runs in one script so the decision is atomic. A Redis error returns 503 `RATE_LIMIT_UNAVAILABLE` and does not serve the request unthrottled. Health is excluded. Auth and money routes use tighter limits than read routes. Keys are per IP and per account. `TRUST_PROXY` is set only to the real hop count so clients cannot spoof the address that the limit uses.
