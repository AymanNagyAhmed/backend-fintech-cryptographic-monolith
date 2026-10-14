// Once TOTP is enabled (totpSecret set by auth.totpSetup), login needs a current code.
// A code works once: wait for the next 30 s step after auth.totpEnable before logging in again.
// @include totp
const secret = pm.environment.get('totpSecret');
if (secret) {
  const body = JSON.parse(pm.variables.replaceIn(pm.request.body.raw));
  body.totpCode = totp(secret);
  pm.request.body.update(JSON.stringify(body, null, 2));
}
