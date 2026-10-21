import { createHash, timingSafeEqual } from 'node:crypto';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATORS = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];
/** BIP-173 bech32 constant. BIP-350 bech32m (taproot) uses the other one. */
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Chain destinations must be a valid bech32, bech32m, or base58check string.
 * `bank_*` rails keep the DTO length check and skip the checksum.
 */
export function addressChecksumOk(network: string, address: string): boolean {
  const rail = network.trim().toLowerCase();
  const value = address.trim();
  if (rail.startsWith('bank_')) return value.length >= 1 && value.length <= 256;
  if (isBech32Shape(value)) return verifyBech32(value);
  if (isBase58Shape(value)) return verifyBase58Check(value);
  return false;
}

function isBech32Shape(value: string): boolean {
  if (value.length < 8 || value.length > 90) return false;
  if (value !== value.toLowerCase() && value !== value.toUpperCase())
    return false;
  const bech = value.toLowerCase();
  const pos = bech.lastIndexOf('1');
  if (pos < 1 || pos + 7 > bech.length) return false;
  const hrp = bech.slice(0, pos);
  const data = bech.slice(pos + 1);
  for (let i = 0; i < hrp.length; i++) {
    const code = hrp.charCodeAt(i);
    if (code < 33 || code > 126) return false;
  }
  for (const ch of data) {
    if (!BECH32_CHARSET.includes(ch)) return false;
  }
  return true;
}

function isBase58Shape(value: string): boolean {
  if (value.length < 5) return false;
  for (const ch of value) {
    if (!BASE58_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk = (chk ^ BECH32_GENERATORS[i]!) >>> 0;
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 31);
  return out;
}

function verifyBech32(value: string): boolean {
  const bech = value.toLowerCase();
  const pos = bech.lastIndexOf('1');
  const hrp = bech.slice(0, pos);
  const data = bech.slice(pos + 1);
  const values: number[] = [];
  for (const ch of data) values.push(BECH32_CHARSET.indexOf(ch));
  const chk = polymod([...hrpExpand(hrp), ...values]);
  return chk === BECH32_CONST || chk === BECH32M_CONST;
}

function decodeBase58(value: string): Buffer | null {
  let num = 0n;
  for (const ch of value) {
    const index = BASE58_ALPHABET.indexOf(ch);
    if (index < 0) return null;
    num = num * 58n + BigInt(index);
  }
  let hex = num.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const body = hex === '0' ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let zeros = 0;
  for (const ch of value) {
    if (ch !== '1') break;
    zeros += 1;
  }
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

function verifyBase58Check(value: string): boolean {
  const decoded = decodeBase58(value);
  if (!decoded || decoded.length < 5) return false;
  const payload = decoded.subarray(0, -4);
  const check = decoded.subarray(-4);
  const hash = createHash('sha256')
    .update(createHash('sha256').update(payload).digest())
    .digest();
  return timingSafeEqual(check, hash.subarray(0, 4));
}
