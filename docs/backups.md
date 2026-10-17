# Database backups and restore (A-B16.6)

## WAL archiving

Compose Postgres starts with `archive_mode=on` via `docker/postgres/entrypoint-wal.sh`. WAL segments are copied into the `pgwal` volume at `/var/lib/postgresql/wal_archive`.

```zsh
cd modular_monolith
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SHOW archive_mode; SHOW archive_command;"
docker compose exec postgres ls /var/lib/postgresql/wal_archive | head
```

For point-in-time recovery in production: take a base backup (`pg_basebackup`), keep the `pgwal` volume (or ship segments to object storage), and restore with `restore_command` pointing at that archive. Local smoke uses a logical dump (below) because it is faster to verify with app tools.

## Logical dump + restore test

```zsh
cd modular_monolith
make db-backup          # -> var/backups/fintech.dump
make db-restore-test    # recreate restore_test, pg_restore, then:
                        # DATABASE_URL=.../restore_test npm run job:reconcile
                        # DATABASE_URL=.../restore_test npm run audit:verify
```

`make db-restore-test` checks ledger reconciliation on `restore_test`, then compares `audit:verify` reports for live vs restore (must match). Known e2e leftover partitions (`vfy-*`, `tamper-*`) may leave `ok: false` on both; fidelity is what the smoke asserts.
