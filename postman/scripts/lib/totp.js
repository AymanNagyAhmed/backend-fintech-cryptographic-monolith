// TOTP (RFC 6238: SHA-1, 6 digits, 30 s) from a base32 secret, with CryptoJS (no Node APIs).
const cryptoJs = require('crypto-js');
function totp(base32Secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('totpSecret is not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  let keyHex = '';
  for (let i = 0; i + 8 <= bits.length; i += 8)
    keyHex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
  const counter = Math.floor(Date.now() / 1000 / 30).toString(16).padStart(16, '0');
  const mac = cryptoJs.HmacSHA1(
    cryptoJs.enc.Hex.parse(counter),
    cryptoJs.enc.Hex.parse(keyHex),
  ).toString(cryptoJs.enc.Hex);
  const offset = parseInt(mac.slice(-1), 16);
  const code = (parseInt(mac.slice(offset * 2, offset * 2 + 8), 16) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}
