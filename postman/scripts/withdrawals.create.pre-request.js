// A payout needs a live TOTP and an active beneficiary. The smoke run has neither.
const secret = pm.environment.get('totpSecret');
const code = pm.environment.get('totpCode');
if (!secret && !code) {
  pm.variables.set('expectedErrorCode', 'INVALID_TOTP');
  pm.variables.set('expectedErrorCodeAlt', 'BENEFICIARY_NOT_ACTIVE');
}
