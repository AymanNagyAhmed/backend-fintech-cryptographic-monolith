# Production image and TLS (A-B16)

## Build

TypedSQL generate needs a reachable Postgres:

```zsh
cd backend_monolith
set -a && source .env && set +a
docker build --network=host \
  --build-arg MIGRATOR_DATABASE_URL="$MIGRATOR_DATABASE_URL" \
  -t fintech-backend:local -f Dockerfile .
docker build --network=host \
  --build-arg MIGRATOR_DATABASE_URL="$MIGRATOR_DATABASE_URL" \
  --target migrate -t fintech-backend-migrate:local -f Dockerfile .
```

Runtime runs as non-root (`node`), with no `prisma` / `vitest` packages. The migrate target keeps the Prisma CLI for `prisma migrate deploy`.

## Compose (parent `modular_monolith/`)

```zsh
cd ../   # modular_monolith
make prod-secrets prod-tls-cert
docker compose -f docker-compose.prod.yml config --quiet
# migrate runs before backend (service_completed_successfully)
make prod-up
```

`docker/entrypoint.sh` loads Docker secret files (`JWT_*_FILE`, `BAO_TOKEN_FILE`, …) and builds `REDIS_URL` from `/run/secrets/redis_password`.

## Hybrid TLS (A-B16.4)

Nginx (`nginx:1.30.5-trixie`, OpenSSL 3.5) terminates TLS 1.3 with:

```nginx
ssl_ecdh_curve X25519MLKEM768:X25519;
```

Set `TRUST_PROXY=1` when the API sits behind this proxy. Verify the negotiated group:

```zsh
docker run --rm --network host alpine:3.24.2 sh -c \
  "apk add -q openssl && openssl s_client -connect localhost:443 -groups X25519MLKEM768 </dev/null 2>&1 | grep -i group"
# expect: Negotiated TLS1.3 group: X25519MLKEM768
```
