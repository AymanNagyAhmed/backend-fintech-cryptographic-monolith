// B2B signed request (A-B4.5): HMAC-SHA256 over
//   METHOD \n path?query \n timestamp \n nonce \n hex(sha256(raw body))
// with the dev-client secret (b2bSecret, filled by npm run postman:env). Ed25519 clients use
// scripts/sign-request.ts instead (the sandbox has no Ed25519).
const cryptoJs = require('crypto-js');
const clientId = pm.environment.get('b2bClientId');
const secret = pm.environment.get('b2bSecret');
if (!clientId || !secret)
  throw new Error('b2bClientId / b2bSecret are empty: run npm run postman:env');

const url = pm.variables.replaceIn(pm.request.url.toString());
const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
const raw = pm.request.body && pm.request.body.raw ? pm.variables.replaceIn(pm.request.body.raw) : '';
// The signature covers these exact bytes, so send the resolved body
if (raw) pm.request.body.update(raw);

const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = pm.variables.replaceIn('{{$guid}}').replace(/-/g, '');
const canonical = [
  pm.request.method.toUpperCase(),
  path,
  timestamp,
  nonce,
  cryptoJs.SHA256(raw).toString(cryptoJs.enc.Hex),
].join('\n');

pm.request.headers.upsert({ key: 'x-client-id', value: clientId });
pm.request.headers.upsert({ key: 'x-timestamp', value: timestamp });
pm.request.headers.upsert({ key: 'x-nonce', value: nonce });
pm.request.headers.upsert({
  key: 'x-signature',
  value: cryptoJs.HmacSHA256(canonical, secret).toString(cryptoJs.enc.Base64),
});
