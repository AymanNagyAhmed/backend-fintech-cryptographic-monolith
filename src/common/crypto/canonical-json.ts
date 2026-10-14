import { createHash } from 'node:crypto';

/**
 * RFC 8785 (JCS) canonical JSON: object keys sorted by UTF-16 code units, no whitespace,
 * strings and numbers serialized as ECMAScript JSON.stringify does. Values are taken like
 * JSON.stringify (toJSON is honoured, undefined and function properties are dropped), but
 * anything JSON cannot represent exactly throws instead of silently becoming null.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$');
}

/** Lowercase hex SHA-256 over the canonical JSON of `value`. */
export function canonicalJsonSha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function serialize(input: unknown, path: string): string {
  const value = hasToJson(input) ? input.toJSON() : input;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value))
        throw new TypeError(`canonicalJson: ${path} is not a finite number`);
      return JSON.stringify(value);
    case 'object':
      if (value === null) return 'null';
      if (Array.isArray(value))
        return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(',')}]`;
      return serializeObject(value as Record<string, unknown>, path);
    default:
      throw new TypeError(`canonicalJson: ${path} is a ${typeof value}`);
  }
}

function serializeObject(value: Record<string, unknown>, path: string): string {
  const members = Object.keys(value)
    .filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
    .sort()
    .map((k) => `${JSON.stringify(k)}:${serialize(value[k], `${path}.${k}`)}`);
  return `{${members.join(',')}}`;
}

function hasToJson(value: unknown): value is { toJSON(): unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  );
}
