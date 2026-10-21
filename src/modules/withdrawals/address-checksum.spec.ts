import { addressChecksumOk } from './address-checksum.js';

const BECH32 = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const BECH32_TRANSPOSED = 'bc1qyx2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const BASE58 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const BASE58_BAD_CHECK = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb';

describe('addressChecksumOk', () => {
  it('accepts BIP-173 bech32 checksums', () => {
    expect(addressChecksumOk('bitcoin', 'A12UEL5L')).toBe(true);
    expect(addressChecksumOk('bitcoin', 'a12uel5l')).toBe(true);
    expect(
      addressChecksumOk(
        'bitcoin',
        'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
      ),
    ).toBe(true);
    expect(
      addressChecksumOk(
        'bitcoin',
        'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
      ),
    ).toBe(true);
  });

  it('rejects a transposed bech32 checksum', () => {
    expect(addressChecksumOk('bitcoin', BECH32)).toBe(true);
    expect(addressChecksumOk('bitcoin', BECH32_TRANSPOSED)).toBe(false);
    expect(addressChecksumOk('bitcoin', 'x1b4n0q5v')).toBe(false);
  });

  it('accepts uppercase bech32 and rejects mixed case', () => {
    expect(addressChecksumOk('bitcoin', BECH32.toUpperCase())).toBe(true);
    expect(addressChecksumOk('bitcoin', 'A12uEL5L')).toBe(false);
  });

  it('accepts a base58check address and rejects a bad check byte', () => {
    expect(addressChecksumOk('bitcoin', BASE58)).toBe(true);
    expect(addressChecksumOk('bitcoin', BASE58_BAD_CHECK)).toBe(false);
  });

  it('keeps a bank reference on length only', () => {
    expect(addressChecksumOk('bank_aed', 'AE070331234567890123456')).toBe(true);
    expect(addressChecksumOk('bank_aed', BECH32_TRANSPOSED)).toBe(true);
    expect(addressChecksumOk('bank_aed', '')).toBe(false);
  });

  it('rejects a chain string that is neither encoding', () => {
    expect(
      addressChecksumOk(
        'ethereum',
        '0xabc0000000000000000000000000000000000000',
      ),
    ).toBe(false);
  });

  it('checks the same checksum on a non-bitcoin chain', () => {
    expect(addressChecksumOk('litecoin', BECH32)).toBe(true);
    expect(addressChecksumOk('litecoin', BASE58)).toBe(true);
    expect(addressChecksumOk('litecoin', BECH32_TRANSPOSED)).toBe(false);
  });
});
