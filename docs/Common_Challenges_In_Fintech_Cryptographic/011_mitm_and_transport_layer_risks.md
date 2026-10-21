# 011. Man-in-the-Middle and Transport-Layer Risks

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    plainHttp[HTTP or a skipped certificate check] --> altered[Amounts and signatures changed on the path]
  end
  subgraph solutionPath [Recommended solution]
    tls13["TLS 1.3 via Nginx, HSTS, hybrid key exchange"] --> chain[Validate the certificate chain]
  end
```

## Problem

Money instructions and signed bodies are only protected if the transport that carries them is authenticated and encrypted. Accepting HTTP, disabling certificate checks in a mobile client, or pinning a leaf certificate that then rotates, each breaks that guarantee in a different way.

## Impact

- A network attacker reads PANs, tokens, or signed instructions.
- A tampered response shows a false balance or a false "payment succeeded".
- A pinned certificate expires and the app fails for every user, which trains people to bypass the check.
- Downgrade to an old TLS version weakens the key exchange that post-quantum hybrid mode was meant to protect.

## Recommended solution

Terminate TLS on Nginx and send HSTS. Prefer TLS 1.3 and validate the full certificate chain. Production hybrid mode negotiates X25519 together with ML-KEM, as in the platform's post-quantum control. On the web, do not pin leaf certificates. Certificate pinning stays a mobile control, with a backup pin and a planned rotation. Application-layer signatures (request signing, webhook MACs) still cover the body so a terminated TLS hop is not the only check.

## Code

```mermaid
flowchart TD
  client["Client"] --> nginx["Nginx port 443, TLS 1.3 only"]
  nginx --> curve["X25519MLKEM768, else X25519"]
  nginx --> app["Backend"]
  app --> hsts["Helmet sends Strict-Transport-Security"]
  b2b["B2B body"] --> guard["SignedRequestGuard over the raw body"]
  hook["Webhook body"] --> mac["HMAC over the raw body"]
```

The production Nginx server listens on 443, allows only TLS 1.3, and prefers `X25519MLKEM768`. It does not set `Strict-Transport-Security` itself. `app.use(helmet())` does, with Helmet's default max-age. B2B bodies are still checked by `SignedRequestGuard` over `req.rawBody`, and webhook MACs use the same raw body. There is no leaf pin in this repository.

```nginx
listen 443 ssl;
http2 on;
server_name _;

ssl_certificate     /etc/nginx/certs/tls.crt;
ssl_certificate_key /etc/nginx/certs/tls.key;

# TLS 1.3 only; prefer hybrid X25519+ML-KEM-768, fall back to classical X25519 (A-B16.4 / 2.7)
ssl_protocols TLSv1.3;
ssl_ecdh_curve X25519MLKEM768:X25519;
```

```typescript
app.use(helmet());
```
