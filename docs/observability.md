# Metrics and OpenTelemetry (A-B16.7)

## Prometheus scrape

`GET /v1/metrics` (public, raw text) exposes:

| Metric | Meaning |
| --- | --- |
| `fintech_clock_offset_seconds` / `fintech_clock_out_of_tolerance` | chrony (A-B16.5) |
| `fintech_outbox_lag` | unprocessed outbox rows |
| `fintech_chainer_chained_total` / `fintech_chainer_skipped_lock_total` | chainer throughput |
| `fintech_checkpoint_tree_size` / `fintech_checkpoint_age_seconds` | latest STH |
| `fintech_tsa_failures_total` | TSA stamp failures |
| `fintech_witness_alerts_total` | witness fork/truncation/rollback |

## Traces

`src/telemetry.ts` starts the OTel Node SDK (auto HTTP/DB instrumentation) and exports OTLP HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://127.0.0.1:4318`). Set `OTEL_SDK_DISABLED=true` to skip.

## Local stack

```zsh
cd modular_monolith
make obs-up
# Jaeger UI http://127.0.0.1:16686
# Prometheus http://127.0.0.1:9090
# Grafana http://127.0.0.1:3001 (admin / GRAFANA_ADMIN_PASSWORD)
make -C . dev   # or existing API on :3000 so Prometheus can scrape host.docker.internal:3000
```

Dashboard **Fintech audit & clock** is provisioned from `docker/grafana/dashboards/fintech-audit.json`. Alert rules live under `docker/prometheus/alerts/`.
