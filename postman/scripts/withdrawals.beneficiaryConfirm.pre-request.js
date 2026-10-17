// Confirm needs a live TOTP; without totpCode the API returns INVALID_TOTP / TOTP_REQUIRED.
const secret = pm.environment.get('totpSecret');
const code = pm.environment.get('totpCode');
if (!secret && !code) {
  pm.variables.set('expectedErrorCode', 'INVALID_TOTP');
  pm.variables.set('expectedErrorCodeAlt', 'TOTP_REQUIRED');
}
