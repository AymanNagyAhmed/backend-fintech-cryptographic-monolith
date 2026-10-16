// Creates PAIRS funded wallet pairs for the chaos run and prints them as JSON.
// Users/wallets over HTTP; funding via a minimal Nest context (LedgerModule only) so
// we do not start a second AppModule (BullMQ / checkpointer / witness) against the same DB.
//   API=http://127.0.0.1:3100 PAIRS=8 node test/chaos/prepare.mjs
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validate } from '../../dist/config/env.validation.js';
import { DatabaseModule } from '../../dist/database/database.module.js';
import { LedgerModule } from '../../dist/modules/ledger/ledger.module.js';
import { LedgerService } from '../../dist/modules/ledger/ledger.service.js';
import { PrismaService } from '../../dist/database/prisma.service.js';

const API = process.env.API ?? 'http://127.0.0.1:3100';
const PAIRS = Number(process.env.PAIRS ?? 8);
const FUNDS = process.env.FUNDS ?? '10000.00';
const password = 'S3cure!pass-123';

class ChaosPrepareModule {}
Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    DatabaseModule,
    LedgerModule,
  ],
})(ChaosPrepareModule);

async function call(method, path, body, token) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

const app = await NestFactory.createApplicationContext(ChaosPrepareModule, {
  logger: false,
});
try {
  const prisma = app.get(PrismaService);
  const ledger = app.get(LedgerService);
  const clearing = await ledger.ensureSystemAccount({
    code: `chaos:${randomUUID()}`,
    currency: 'AED',
    allowNegative: true,
  });
  const pairs = [];
  for (let i = 0; i < PAIRS; i++) {
    const email = `chaos-${randomUUID()}@example.com`;
    await call('POST', '/auth/register', { email, password });
    const { accessToken } = await call('POST', '/auth/login', { email, password });
    const wallets = [];
    for (let w = 0; w < 2; w++) {
      const { id } = await call('POST', '/wallets', { currency: 'AED' }, accessToken);
      const { ledgerAccountId } = await prisma.wallet.findUniqueOrThrow({ where: { id } });
      await ledger.post({
        ref: `chaos:${randomUUID()}`,
        entries: [
          { accountId: clearing.id, amount: `-${FUNDS}` },
          { accountId: ledgerAccountId, amount: FUNDS },
        ],
      });
      wallets.push(id);
    }
    pairs.push({ token: accessToken, from: wallets[0], to: wallets[1] });
  }
  process.stdout.write(JSON.stringify(pairs));
} finally {
  await app.close();
}
