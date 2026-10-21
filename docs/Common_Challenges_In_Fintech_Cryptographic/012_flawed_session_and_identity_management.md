# 012. Flawed Session and Identity Management

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    longLived["Long-lived token, no reuse detection"] --> stolenSession[Stolen refresh token stays valid after logout]
  end
  subgraph solutionPath [Recommended solution]
    shortJwt["15-minute access JWT, algorithm pinned"] --> family[Refresh reuse revokes the session family]
  end
```

## Problem

Sessions fail when tokens live too long, when logout does not invalidate them, when the server accepts any JWT algorithm the header names, or when a stolen refresh token can be used beside the real user's new one. "Logged out" on the client is not logout if the server still honors the token.

## Impact

- Account takeover that survives a password change.
- A leaked token in a log or a browser extension keeps working for days.
- An `alg: none` or algorithm-confusion token is accepted.
- Two devices share one refresh token and a theft on one is invisible on the other.

## Recommended solution

Access tokens last 15 minutes, are HS256, and verification pins `algorithms: ['HS256']` with issuer and audience. Refresh tokens are 256-bit opaque values. The server stores only an HMAC. Rotation detects reuse and revokes the whole session family. Logout invalidates that family. Passwords use Argon2id via `node:crypto`. Global `JwtAuthGuard` and `RolesGuard` deny every route that is not marked `@Public()`.

## Code

```mermaid
flowchart TD
  password["Password"] --> argon["Argon2id verify"]
  argon --> jwt["Access JWT, HS256, issuer and audience pinned"]
  jwt --> refresh["Opaque refresh token, HMAC stored"]
  refresh --> reuse{"presented token already used?"}
  reuse -->|yes| revoke["revokedAt on the family, outcome reused"]
  reuse -->|no| rotate["Store the next refresh token"]
```

`JwtModule` signs and verifies only `HS256`, with `JWT_ISSUER` and `JWT_AUDIENCE` pinned. A refresh that finds the token already used sets `revokedAt` on every live row in that `familyId` and returns `reused`. `PasswordHasher.hash` writes an `$argon2id$` string. `REFRESH_TOKEN_BYTES` is 32.

```typescript
verifyOptions: {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
},
```

```typescript
if (claimed.count === 0) {
  if (!row.usedAt) return { kind: 'invalid' }; // expired or revoked by logout
  await tx.refreshToken.updateMany({
    where: { familyId: row.familyId, revokedAt: null },
    data: { revokedAt: now },
  });
  return { kind: 'reused' };
}
```

```typescript
return `$argon2id$v=${VERSION}$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(tag)}`;
```
