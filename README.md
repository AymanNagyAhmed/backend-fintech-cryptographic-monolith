# Backend monolith

NestJS API for the fintech modular monolith. PostgreSQL, Redis, and OpenBao run in Docker. The API runs on the host with Node 24.21.0.

Commands below use `zsh` on WSL2 Ubuntu. Run them from the paths shown. `make` targets live in `modular_monolith/`, one directory above this folder.

## Prerequisites

Install once per machine:

```zsh
sudo apt-get update && sudo apt-get install -y git curl jq make openssl
```

- **Node.js 24.21.0** via nvm (`.nvmrc` pins this version):

```zsh
# https://github.com/nvm-sh/nvm
nvm install 24.21.0
nvm alias default 24.21.0
```

- **Docker Engine** with the Compose plugin, and your user in the `docker` group. Docker Desktop with WSL integration for this distro works too.

```zsh
docker --version && docker compose version
```

If `docker ps` fails with `permission denied` on `/var/run/docker.sock`, add your user to the `docker` group and open a new shell, or turn on WSL integration in Docker Desktop.

Keep this repo on the Linux filesystem (`~/ai_projects/...`), not under `/mnt/c`.

## Install

From the monolith directory, copy both env files and replace every `change-me`. Passwords in `backend_monolith/.env` must match `modular_monolith/.env`: `APP_WRITER_PASSWORD`, `MIGRATOR_PASSWORD`, `REDIS_PASSWORD`, and `BAO_DEV_ROOT_TOKEN` (used as `BAO_TOKEN` until the signer token is created below).

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith
cp .env.example .env
cp backend_monolith/.env.example backend_monolith/.env
# generate values, then paste them into both .env files where the names match
openssl rand -base64 32
```

Install dependencies with the lockfile:

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith/backend_monolith
source ~/.nvm/nvm.sh && nvm use 24.21.0
npm ci
```

Start Postgres, Redis, and OpenBao, then apply migrations and seed:

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith
make up
make migrate
make seed
```

`make up` publishes Postgres on `127.0.0.1:5433`, Redis on `127.0.0.1:6379`, and OpenBao on `127.0.0.1:8200`. LocalStack (S3) stays off until `LOCALSTACK_AUTH_TOKEN` is set and `COMPOSE_PROFILES=s3` is added to `modular_monolith/.env`.

Create the Transit signing key, then a token that can only sign. Put the printed token in `BAO_TOKEN` in `backend_monolith/.env`. Keep the root token in `BAO_ADMIN_TOKEN`.

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith
set -a && source .env && set +a
docker compose exec -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN=$BAO_DEV_ROOT_TOKEN openbao \
  sh -c 'bao secrets enable transit && bao write -f transit/keys/audit-signing type=ed25519'
cd backend_monolith
source ~/.nvm/nvm.sh && nvm use 24.21.0
npm run openbao:setup-audit-signer
```

OpenBao dev mode is in memory. After `make down` or a container restart, run the Transit command and `npm run openbao:setup-audit-signer` again.

## Run

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith
make dev
```

The API listens on `http://localhost:3000`. Check it from another terminal:

```zsh
curl -sf http://localhost:3000/v1/health/live
curl -sf http://localhost:3000/v1/health/ready
```

Stop the API with Ctrl+C. Stop the containers with:

```zsh
cd ~/ai_projects/fintec_cryptographic/modular_monolith
make down
```

Follow container logs with `make logs`.

To run the API inside Compose instead of on the host, set `COMPOSE_PROFILES=docker-backend` in `modular_monolith/.env` and run `make up`. The usual local path is `make up` plus `make dev`.
