// Confirms the secret from auth.totpSetup with the current code
// @include totp
const secret = pm.environment.get('totpSecret');
if (!secret) throw new Error('totpSecret is empty: send auth.totpSetup first');
pm.variables.set('totpCode', totp(secret));
