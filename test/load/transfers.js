/**
 * A-B9.10 — transfer load against POST /v1/transfers.
 *
 * Env:
 *   BASE_URL     default http://127.0.0.1:3000
 *   TOKEN        Bearer access token (required)
 *   FROM_WALLET  funded source wallet id (required)
 *   TO_WALLET    destination wallet id (required)
 *   PARTITIONS   1 | 4 | 16 — informational; server uses AUDIT_PARTITION_COUNT
 *   AMOUNT       default 0.01
 *   CURRENCY     default AED
 *   VUS          default 10
 *   DURATION     default 30s
 *
 * Example:
 *   docker run --rm -i --network host \
 *     -e TOKEN=$TOKEN -e FROM_WALLET=$FROM -e TO_WALLET=$TO -e PARTITIONS=16 \
 *     grafana/k6:1.8.2 run - < test/load/transfers.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const TOKEN = __ENV.TOKEN || '';
const FROM_WALLET = __ENV.FROM_WALLET || '';
const TO_WALLET = __ENV.TO_WALLET || '';
const PARTITIONS = __ENV.PARTITIONS || '16';
const AMOUNT = __ENV.AMOUNT || '0.01';
const CURRENCY = __ENV.CURRENCY || 'AED';
const VUS = Number(__ENV.VUS || '10');
const DURATION = __ENV.DURATION || '30s';

const transferFail = new Rate('transfer_fail');
const transferDuration = new Trend('transfer_duration', true);

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    transfer_fail: ['rate<0.05'],
    // Request path must stay within budget whether the chainer is running or paused (2.5)
    http_req_duration: ['p(99)<500'],
  },
  tags: { partitions: PARTITIONS },
};

export function setup() {
  if (!TOKEN || !FROM_WALLET || !TO_WALLET) {
    throw new Error(
      'TOKEN, FROM_WALLET and TO_WALLET are required (PARTITIONS is informational)',
    );
  }
  return { partitions: PARTITIONS };
}

export default function () {
  const url = `${BASE_URL}/v1/transfers`;
  const payload = JSON.stringify({
    fromWalletId: FROM_WALLET,
    toWalletId: TO_WALLET,
    amount: AMOUNT,
    currency: CURRENCY,
  });
  const res = http.post(url, payload, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': uuidv4(),
    },
    tags: { name: 'POST /v1/transfers' },
  });
  transferDuration.add(res.timings.duration);
  const ok = check(res, {
    'status 201': (r) => r.status === 201,
    'envelope success': (r) => {
      try {
        return r.json('success') === true;
      } catch {
        return false;
      }
    },
  });
  transferFail.add(!ok);
  sleep(0.05);
}

export function handleSummary(data) {
  const p99 = data.metrics.http_req_duration?.values['p(99)'];
  const rps = data.metrics.http_reqs?.values.rate;
  const line = [
    `partitions=${PARTITIONS}`,
    `p99_ms=${p99 != null ? p99.toFixed(2) : 'n/a'}`,
    `rps=${rps != null ? rps.toFixed(2) : 'n/a'}`,
    `fails=${data.metrics.transfer_fail?.values.rate ?? 'n/a'}`,
  ].join(' ');
  return {
    stdout: `\nA-B9.10 summary: ${line}\n`,
  };
}
