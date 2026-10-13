import { SetMetadata } from '@nestjs/common';

export const THROTTLE_BY_ACCOUNT_KEY = 'throttleByAccount';

/**
 * Also limits the route per account (the `email` in the body), not only per IP,
 * so password and TOTP guessing stay bounded when an attacker rotates IPs.
 */
export const ThrottleByAccount = () =>
  SetMetadata(THROTTLE_BY_ACCOUNT_KEY, true);
