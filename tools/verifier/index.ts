#!/usr/bin/env tsx
/**
 * Offline export verifier (A-B12.4). No network, no database.
 *
 *   npm run verify:export -- /path/to/export.zip
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

interface Manifest {
  recordCount: number;
  recordsSha256: string;
  proofsSha256: string;
  sthSha256: string;
  publicKeysSha256?: string;
  manifestSha256?: string;
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function sha(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Minimal ZIP local-file reader (store + deflate). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 < buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const compressed = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else fail(`unsupported compression method ${method} for ${name}`);
    out.set(name, data);
    i = start + compSize;
  }
  return out;
}

function main(): void {
  const zipPath = process.argv[2];
  if (!zipPath) fail('usage: npm run verify:export -- <export.zip>');
  const zipBuf = readFileSync(zipPath);
  const files = unzip(zipBuf);
  const manifestRaw = files.get('manifest.json');
  const recordsRaw = files.get('records.json');
  const proofsRaw = files.get('proofs.json');
  const sthRaw = files.get('sth.json');
  const keysRaw = files.get('public-keys.json');
  if (!manifestRaw || !recordsRaw || !proofsRaw || !sthRaw)
    fail('missing required files in ZIP');

  const manifest = JSON.parse(manifestRaw.toString('utf8')) as Manifest;
  if (sha(recordsRaw) !== manifest.recordsSha256)
    fail('records.json hash mismatch (tampered)');
  if (sha(proofsRaw) !== manifest.proofsSha256)
    fail('proofs.json hash mismatch (tampered)');
  if (sha(sthRaw) !== manifest.sthSha256)
    fail('sth.json hash mismatch (tampered)');
  if (
    keysRaw &&
    manifest.publicKeysSha256 &&
    sha(keysRaw) !== manifest.publicKeysSha256
  )
    fail('public-keys.json hash mismatch (tampered)');

  const records = JSON.parse(recordsRaw.toString('utf8')) as unknown[];
  if (records.length !== manifest.recordCount)
    fail(`recordCount ${manifest.recordCount} != ${records.length}`);

  const { manifestSha256: embedded, ...body } = manifest;
  const recomputed = sha(JSON.stringify(body));
  if (embedded && embedded !== recomputed)
    fail('manifestSha256 mismatch (tampered)');

  console.log(
    `PASS: ${zipPath} (${manifest.recordCount} records, manifest ok)`,
  );
}

main();
