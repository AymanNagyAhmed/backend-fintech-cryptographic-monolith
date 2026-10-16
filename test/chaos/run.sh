#!/usr/bin/env bash
# A-B15.4 chaos suite: k6 transfer load while toxiproxy and container kills hurt PostgreSQL and
# Redis, then per-partition audit invariants, ledger reconciliation and outbox drain.
#   make -C $MM test-chaos        (CHAOS_DURATION=60 CHAOS_PAIRS=6 CHAOS_VUS=8)
#
# On Docker Desktop / WSL2, `docker run --network host` does not share the WSL localhost
# namespace, so k6 uses host.docker.internal (API binds 0.0.0.0).
set -euo pipefail

BE="$(cd "$(dirname "$0")/../.." && pwd)"
MM="$(cd "$BE/.." && pwd)"
cd "$MM"
set -a; source ./.env; set +a
source ~/.nvm/nvm.sh && nvm use --silent 24.21.0

K6_TAG="${K6_TAG:-1.8.2}"
PORT="${CHAOS_PORT:-3100}"
DURATION="${CHAOS_DURATION:-60}"
PAIRS="${CHAOS_PAIRS:-6}"
VUS="${CHAOS_VUS:-8}"
TOXI=http://127.0.0.1:8474
DC="docker compose --profile chaos"
LOG="$(mktemp -d)"
API_PID=""
K6_BASE_URL="http://host.docker.internal:${PORT}"

psql_q() { $DC exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }
toxic() { curl -sf -X POST "$TOXI/proxies/$1/toxics" -H 'Content-Type: application/json' -d "$2" >/dev/null; }
untoxic() { curl -sf -X DELETE "$TOXI/proxies/$1/toxics/$2" >/dev/null || true; }
proxy_enabled() { curl -sf -X POST "$TOXI/proxies/$1" -H 'Content-Type: application/json' -d "{\"enabled\":$2}" >/dev/null; }
say() { printf '\n== %s\n' "$*"; }

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  proxy_enabled postgres true 2>/dev/null || true
  proxy_enabled redis true 2>/dev/null || true
}
trap cleanup EXIT

say "start PostgreSQL, Redis, OpenBao and toxiproxy"
$DC up -d postgres redis openbao toxiproxy
for i in $(seq 1 60); do curl -sf "$TOXI/version" >/dev/null && break; sleep 1; done

say "build and start the API on 0.0.0.0:$PORT behind the proxies"
(cd "$BE" && npm run build --silent)
DB_VIA_PROXY="$(grep -E '^DATABASE_URL=' "$BE/.env" | cut -d= -f2- | sed -E 's#@[^/]+/#@127.0.0.1:15432/#')"
REDIS_VIA_PROXY="$(grep -E '^REDIS_URL=' "$BE/.env" | cut -d= -f2- | sed -E 's#@[^/]+$#@127.0.0.1:16379#')"
(cd "$BE" && PORT="$PORT" CHAOS_HOST=0.0.0.0 DATABASE_URL="$DB_VIA_PROXY" REDIS_URL="$REDIS_VIA_PROXY" \
  node test/chaos/server.mjs >"$LOG/api.log" 2>&1) &
API_PID=$!
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/v1/health/live" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$PORT/v1/health/live" >/dev/null || { cat "$LOG/api.log"; exit 1; }

say "prepare $PAIRS funded wallet pairs"
PAIRS_JSON="$(cd "$BE" && API="http://127.0.0.1:$PORT" PAIRS="$PAIRS" node test/chaos/prepare.mjs)"
EVENTS_BEFORE="$(psql_q -Atc 'SELECT count(*) FROM audit.audit_events')"

say "k6 load for ${DURATION}s with faults (BASE_URL=$K6_BASE_URL)"
docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  -e BASE_URL="$K6_BASE_URL" -e PAIRS_JSON="$PAIRS_JSON" -e VUS="$VUS" -e DURATION="${DURATION}s" \
  "grafana/k6:$K6_TAG" run - < "$BE/test/load/chaos.js" >"$LOG/k6.log" 2>&1 &
K6_PID=$!

at() { sleep "$1"; }
at 8;  say "t+8 PostgreSQL latency 300ms +-100ms for 8s"
toxic postgres '{"name":"lat","type":"latency","stream":"downstream","attributes":{"latency":300,"jitter":100}}'
at 8;  untoxic postgres lat
at 4;  say "t+20 PostgreSQL connections reset for 4s"
toxic postgres '{"name":"rst","type":"reset_peer","stream":"downstream","attributes":{"timeout":0}}'
at 4;  untoxic postgres rst
at 5;  say "t+29 Redis unreachable for 5s"
proxy_enabled redis false
at 5;  proxy_enabled redis true
at 4;  say "t+38 Redis container killed (AOF), restarted 3s later"
$DC kill -s KILL redis
at 3;  $DC up -d redis
at 6;  say "t+47 PostgreSQL container killed, restarted 3s later"
$DC kill -s KILL postgres
at 3;  $DC up -d postgres

wait "$K6_PID" && K6_RC=0 || K6_RC=$?
tail -n 40 "$LOG/k6.log"

say "wait for PostgreSQL / Redis / API, then drain outbox via ChainerService"
for i in $(seq 1 60); do psql_q -Atc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
proxy_enabled postgres true 2>/dev/null || true
proxy_enabled redis true 2>/dev/null || true
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/v1/health/live" >/dev/null && break; sleep 1; done
# Direct drain (BullMQ may still be reconnecting after Redis kill).
(cd "$BE" && node test/chaos/drain.mjs >"$LOG/drain.log" 2>&1) || {
  echo "FAIL: outbox drain";
  tail -n 40 "$LOG/drain.log";
  exit 1;
}
tail -n 15 "$LOG/drain.log"
PENDING="$(psql_q -At -f - < "$BE/test/chaos/pending-outbox.sql")"
RC=0
[ "$K6_RC" -eq 0 ] || { echo "FAIL: k6 thresholds crossed (exit $K6_RC)"; RC=1; }
[ -z "$PENDING" ] || { echo "FAIL: outbox rows still pending: $PENDING"; RC=1; }

say "partition invariants"
OUT="$(psql_q -f - < "$BE/test/chaos/invariants.sql")"
echo "$OUT"
[ "$(echo "$OUT" | grep -c '(0 rows)')" -eq 2 ] || { echo "FAIL: audit invariant violated"; RC=1; }
EVENTS_AFTER="$(psql_q -Atc 'SELECT count(*) FROM audit.audit_events')"
echo "audit events: before=$EVENTS_BEFORE after=$EVENTS_AFTER"
[ "$EVENTS_AFTER" -gt "$EVENTS_BEFORE" ] || { echo "FAIL: no new audit events during the run"; RC=1; }

say "hash-chain verifier and ledger reconciliation"
# Skips leftover vfy-/tamper- partitions from the tamper suite (append-only table).
(cd "$BE" && node test/chaos/verify.mjs >"$LOG/verify.json" 2>"$LOG/verify.err") \
  || { echo "FAIL: audit:verify"; cat "$LOG/verify.err"; cat "$LOG/verify.json"; RC=1; }
(cd "$BE" && npm run --silent job:reconcile >"$LOG/reconcile.json" 2>"$LOG/reconcile.err") \
  || { echo "FAIL: reconciliation"; cat "$LOG/reconcile.err"; RC=1; }
tail -n 1 "$LOG/reconcile.err" || true

[ "$RC" -eq 0 ] && say "chaos suite PASSED (logs: $LOG)" || say "chaos suite FAILED (logs: $LOG)"
exit "$RC"
