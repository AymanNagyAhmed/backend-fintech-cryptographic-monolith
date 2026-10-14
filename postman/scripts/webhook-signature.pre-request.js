// Payment webhook (A-B7.2): x-signature = hex(HMAC-SHA256(secret, x-timestamp + "." + raw body))
// with the provider secret (webhookSecretStripe, filled by npm run postman:env). A new event id
// per request; keepWebhookEventId = true sends the previous one again (redelivery test).
const cryptoJs = require('crypto-js');
const SECRETS = { stripe: 'webhookSecretStripe' };

const providerVar = pm.request.url.variables.get('provider');
const provider = pm.variables.replaceIn(providerVar || 'stripe');
const secret = pm.environment.get(SECRETS[provider]);
if (!secret)
  throw new Error(`${SECRETS[provider] || 'webhook secret'} is empty: run npm run postman:env`);

if (pm.environment.get('keepWebhookEventId') !== 'true' || !pm.environment.get('webhookEventId'))
  pm.environment.set('webhookEventId', `evt_${pm.variables.replaceIn('{{$guid}}').replace(/-/g, '')}`);

const raw = pm.request.body && pm.request.body.raw ? pm.variables.replaceIn(pm.request.body.raw) : '';
// The signature covers these exact bytes, so send the resolved body
if (raw) pm.request.body.update(raw);

const timestamp = Math.floor(Date.now() / 1000).toString();
pm.request.headers.upsert({ key: 'x-timestamp', value: timestamp });
pm.request.headers.upsert({
  key: 'x-signature',
  value: cryptoJs.HmacSHA256(`${timestamp}.${raw}`, secret).toString(cryptoJs.enc.Hex),
});
