/**
 * A-B15.4 - transfer load while faults are injected (run by test/chaos/run.sh).
 *
 * Env: BASE_URL (default http://127.0.0.1:3100), PAIRS_JSON (array of {token, from, to}),
 *      VUS (default 10), DURATION (default 80s), AMOUNT (default 0.01).
 *
 * Faults make some requests fail. What must hold is: no response that claims success
 * without having happened, no 5xx body without the error envelope, and the invariants
 * checked by run.sh afterwards (no partition gaps, ledger reconciles, outbox drains).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const PAIRS = JSON.parse(__ENV.PAIRS_JSON || '[]');
const AMOUNT = __ENV.AMOUNT || '0.01';

const created = new Counter('transfers_created');
const badEnvelope = new Rate('bad_envelope');

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '80s',
  thresholds: {
    // Faults may fail requests, but never with an unstructured answer.
    bad_envelope: ['rate<0.001'],
    // Some transfers must succeed (before, between and after the faults).
    transfers_created: ['count>100'],
  },
};

export function setup() {
  if (PAIRS.length === 0) throw new Error('PAIRS_JSON is required');
}

export default function () {
  const pair = PAIRS[(__VU - 1) % PAIRS.length];
  const res = http.post(
    `${BASE_URL}/v1/transfers`,
    JSON.stringify({
      fromWalletId: pair.from,
      toWalletId: pair.to,
      amount: AMOUNT,
      currency: 'AED',
    }),
    {
      headers: {
        Authorization: `Bearer ${pair.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': uuidv4(),
      },
      tags: { name: 'POST /v1/transfers' },
      timeout: '15s',
    },
  );
  if (res.status === 201) created.add(1);
  // Timeouts surface as status 0; everything else must carry the envelope.
  let structured = res.status === 0;
  if (!structured) {
    try {
      structured = typeof res.json('success') === 'boolean';
    } catch (e) {
      structured = false;
    }
  }
  badEnvelope.add(!structured);
  check(res, { 'structured answer': () => structured });
  sleep(0.05);
}
