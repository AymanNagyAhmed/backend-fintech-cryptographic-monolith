// Prints the signed-request headers (A-B4.5) for one request, as a B2B client would send them.
//   B2B_SECRET=b2b_... npm run sign-request -- --client dev-client --method POST --path /v1/b2b/ping --body '{"message":"hi"}'
//   npm run sign-request -- --client partner-x --private-key partner-x.pem --method POST --path /v1/b2b/ping --body '{}'
// --json prints one JSON object (e.g. for jq); the default is one "name: value" line per header.
// The body must be sent byte for byte as signed (curl --data-raw "$BODY").
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { signRequestHeaders } from '../src/common/request-signing/canonical-request.js';

const { values } = parseArgs({
  options: {
    client: { type: 'string' },
    method: { type: 'string', default: 'POST' },
    path: { type: 'string' },
    body: { type: 'string', default: '' },
    'private-key': { type: 'string' },
    timestamp: { type: 'string' },
    nonce: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

// The HMAC secret comes from the environment, so it stays out of the shell history
const secret = process.env.B2B_SECRET;
if (!values.client || !values.path || (!secret && !values['private-key'])) {
  console.error(
    'usage: [B2B_SECRET=...] sign-request --client <id> --path </v1/...> [--method POST] [--body <json>] [--private-key <pem>] [--timestamp <unix s>] [--nonce <nonce>] [--json]',
  );
  process.exit(2);
}

const headers = signRequestHeaders({
  clientId: values.client,
  method: values.method,
  path: values.path,
  body: values.body,
  key: values['private-key']
    ? createPrivateKey(readFileSync(values['private-key']))
    : secret!,
  timestamp: values.timestamp,
  nonce: values.nonce,
});

console.log(
  values.json
    ? JSON.stringify(headers)
    : Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
);
