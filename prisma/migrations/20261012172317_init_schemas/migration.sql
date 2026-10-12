-- Bounded-context schemas, owned by migrator (the role that runs migrations).
-- Roles come from docker/postgres/init/01-roles.sql. Grants live here, not in the init script,
-- because `prisma migrate reset` drops these schemas and replays the migrations.
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "wallet";
CREATE SCHEMA IF NOT EXISTS "ledger";
CREATE SCHEMA IF NOT EXISTS "payments";
CREATE SCHEMA IF NOT EXISTS "withdrawals";
CREATE SCHEMA IF NOT EXISTS "audit";
CREATE SCHEMA IF NOT EXISTS "crypto";
CREATE SCHEMA IF NOT EXISTS "privacy";
CREATE SCHEMA IF NOT EXISTS "compliance";
CREATE SCHEMA IF NOT EXISTS "reserves";

-- app_writer: read and write, never DELETE or DDL. Tables that must be append-only
-- (ledger entries, ...) revoke UPDATE in the migration that creates them.
GRANT USAGE ON SCHEMA auth, wallet, ledger, payments, withdrawals, audit, crypto, privacy, compliance, reserves
  TO app_writer;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator
  IN SCHEMA auth, wallet, ledger, payments, withdrawals, crypto, privacy, compliance, reserves
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_writer;

-- audit is append-only for the application
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit
  GRANT SELECT, INSERT ON TABLES TO app_writer;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator
  IN SCHEMA auth, wallet, ledger, payments, withdrawals, audit, crypto, privacy, compliance, reserves
  GRANT USAGE, SELECT ON SEQUENCES TO app_writer;

-- auditor_ro: read-only on audit and compliance
GRANT USAGE ON SCHEMA audit, compliance TO auditor_ro;

ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA audit, compliance
  GRANT SELECT ON TABLES TO auditor_ro;
