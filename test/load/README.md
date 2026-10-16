# Load tests (A-B9.10)

Pinned image: `grafana/k6:1.8.2` (`grafana/k6@sha256:bd6ae8607c0a05d0dc0dc3f5753c464b0929baf083ef0f20b7eed845a3d9e6b4`).

Server-side partitioning uses `AUDIT_PARTITION_COUNT` (restart after change). The k6 `PARTITIONS` env is a tag for comparing runs (1 vs 4 vs 16).

## Prep

```zsh
# Terminal A: API with chainer on
cd $MM && make up && make dev

# Fund two wallets, export TOKEN / FROM_WALLET / TO_WALLET (Bearer without "Bearer ")
```

## Benchmark (chainer running)

```zsh
cd $BE
for P in 1 4 16; do
  # Restart API with AUDIT_PARTITION_COUNT=$P between runs
  docker run --rm -i --network host \
    -e TOKEN="$TOKEN" -e FROM_WALLET="$FROM_WALLET" -e TO_WALLET="$TO_WALLET" \
    -e PARTITIONS=$P -e VUS=10 -e DURATION=30s \
    grafana/k6:1.8.2 run - < test/load/transfers.js
done
```

## Chainer paused vs running (p99 within budget)

There is no separate `backend-worker` Compose service; the chainer is in-process BullMQ.
Pause it by setting `CHAINER_CRON` to a far-future pattern (e.g. `0 0 1 1 *`) and restarting `make dev`, then re-run k6. p99 should stay under the 500 ms threshold either way (requests never wait on the chainer).

## Makefile

```zsh
make -C $MM load-test TOKEN=... FROM_WALLET=... TO_WALLET=... PARTITIONS=16
```
