import { invalidWalletLabel } from './exceptions/wallet.exceptions.js';

export const WALLET_LABEL_MAX_LENGTH = 50;

/** C0, DEL and C1 control characters; same ranges as the wallets_label_chk CHECK. */
const isControlChar = (char: string) => {
  const code = char.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

/**
 * Trims and NFC-normalizes a user-written label, then applies the rules of the
 * `wallets_label_chk` CHECK, so a bad label fails with INVALID_LABEL (422) before the database.
 * Length counts code points, like PostgreSQL `char_length` / `VARCHAR(50)`.
 */
export function normalizeWalletLabel(raw: string): string {
  const label = raw.normalize('NFC').trim();
  const chars = Array.from(label);
  if (chars.length === 0) throw invalidWalletLabel('must not be empty');
  if (chars.length > WALLET_LABEL_MAX_LENGTH)
    throw invalidWalletLabel(
      `must be at most ${WALLET_LABEL_MAX_LENGTH} characters`,
    );
  if (chars.some(isControlChar))
    throw invalidWalletLabel('must not contain control characters');
  return label;
}
