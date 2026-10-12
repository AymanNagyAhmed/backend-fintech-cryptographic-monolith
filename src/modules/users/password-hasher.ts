import { Inject, Injectable, Optional } from '@nestjs/common';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

export interface Argon2Params {
  /** Memory cost in KiB. */
  memory: number;
  /** Passes (iterations). */
  passes: number;
  parallelism: number;
}

export const ARGON2_PARAMS = Symbol('ARGON2_PARAMS');

// RFC 9106 section 4, second recommended option (64 MiB); OWASP's minimum is m=19456, t=2, p=1
export const DEFAULT_ARGON2: Argon2Params = {
  memory: 65_536,
  passes: 3,
  parallelism: 4,
};

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const VERSION = 19;
const PHC =
  /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedHash extends Argon2Params {
  version: number;
  salt: Buffer;
  tag: Buffer;
}

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

function parse(encoded: string): ParsedHash | undefined {
  const m = PHC.exec(encoded);
  if (!m) return undefined;
  return {
    version: Number(m[1]),
    memory: Number(m[2]),
    passes: Number(m[3]),
    parallelism: Number(m[4]),
    salt: Buffer.from(m[5], 'base64'),
    tag: Buffer.from(m[6], 'base64'),
  };
}

/** argon2id with node:crypto, stored as a PHC string: $argon2id$v=19$m=..,t=..,p=..$salt$hash */
@Injectable()
export class PasswordHasher {
  private readonly params: Argon2Params;

  constructor(@Optional() @Inject(ARGON2_PARAMS) params?: Argon2Params) {
    this.params = params ?? DEFAULT_ARGON2;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await this.derive(password, salt, this.params, TAG_BYTES);
    const { memory: m, passes: t, parallelism: p } = this.params;
    return `$argon2id$v=${VERSION}$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(tag)}`;
  }

  /** False for a wrong password and for a malformed or non-argon2id hash. */
  async verify(encoded: string, password: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (!parsed || parsed.version !== VERSION || parsed.tag.length < 16)
      return false;
    const tag = await this.derive(
      password,
      parsed.salt,
      parsed,
      parsed.tag.length,
    );
    return timingSafeEqual(tag, parsed.tag);
  }

  /** True when the hash was made with other parameters than the current ones. */
  needsRehash(encoded: string): boolean {
    const p = parse(encoded);
    return (
      !p ||
      p.version !== VERSION ||
      p.memory !== this.params.memory ||
      p.passes !== this.params.passes ||
      p.parallelism !== this.params.parallelism
    );
  }

  private derive(
    password: string,
    salt: Buffer,
    params: Argon2Params,
    tagLength: number,
  ): Promise<Buffer> {
    return argon2Async('argon2id', {
      message: Buffer.from(password.normalize('NFKC'), 'utf8'),
      nonce: salt,
      parallelism: params.parallelism,
      tagLength,
      memory: params.memory,
      passes: params.passes,
    });
  }
}
