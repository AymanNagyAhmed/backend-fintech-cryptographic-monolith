import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';

const TIMEOUT_MS = 5000;

/**
 * Per-subject OpenBao Transit keys for crypto-shredding (A-B11.1 / 2.8).
 * Key name: `subject-<userId>`; `deletion_allowed=true` so erasure can destroy it.
 * DB and backups only ever hold ciphertext from Transit encrypt.
 */
@Injectable()
export class SubjectKeysService {
  private readonly logger = new Logger(SubjectKeysService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private fetchFn: typeof fetch;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.baseUrl = config.get('BAO_ADDR', { infer: true }).replace(/\/+$/, '');
    this.token = config.get('BAO_TOKEN', { infer: true });
    this.fetchFn = fetch;
  }

  /** Tests only: swap the HTTP client. */
  useFetch(fetchFn: typeof fetch): void {
    this.fetchFn = fetchFn;
  }

  keyName(userId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(userId))
      throw new Error('subject key userId must be a UUID');
    return `subject-${userId}`;
  }

  /** Create aes256-gcm96 key with deletion_allowed (idempotent if already present). */
  async ensureKey(userId: string): Promise<string> {
    const name = this.keyName(userId);
    const existing = await this.readKey(name);
    if (existing) {
      await this.allowDeletion(name);
      return name;
    }
    await this.request('POST', `transit/keys/${encodeURIComponent(name)}`, {
      type: 'aes256-gcm96',
      deletion_allowed: true,
      exportable: false,
    });
    await this.allowDeletion(name);
    this.logger.log({ key: name }, 'Subject Transit key created');
    return name;
  }

  async encrypt(userId: string, plaintext: string): Promise<string> {
    const name = await this.ensureKey(userId);
    const data = await this.request<{ ciphertext?: string }>(
      'POST',
      `transit/encrypt/${encodeURIComponent(name)}`,
      { plaintext: Buffer.from(plaintext, 'utf8').toString('base64') },
    );
    if (!data?.ciphertext)
      throw new Error(`Transit encrypt returned no ciphertext for ${name}`);
    return data.ciphertext;
  }

  async decrypt(userId: string, ciphertext: string): Promise<string | null> {
    const name = this.keyName(userId);
    try {
      const data = await this.request<{ plaintext?: string }>(
        'POST',
        `transit/decrypt/${encodeURIComponent(name)}`,
        { ciphertext },
      );
      if (!data?.plaintext) return null;
      return Buffer.from(data.plaintext, 'base64').toString('utf8');
    } catch {
      // Key destroyed or ciphertext invalid → crypto-shredded
      return null;
    }
  }

  /** Destroy the subject key (erasure). Irreversible for that subject's ciphertext. */
  async deleteKey(userId: string): Promise<void> {
    const name = this.keyName(userId);
    await this.allowDeletion(name);
    await this.request(
      'DELETE',
      `transit/keys/${encodeURIComponent(name)}`,
      undefined,
    );
    this.logger.log({ key: name }, 'Subject Transit key deleted (erasure)');
  }

  private async allowDeletion(name: string): Promise<void> {
    await this.request(
      'POST',
      `transit/keys/${encodeURIComponent(name)}/config`,
      { deletion_allowed: true },
    );
  }

  private async readKey(name: string): Promise<unknown | null> {
    try {
      return await this.request('GET', `transit/keys/${encodeURIComponent(name)}`);
    } catch (e) {
      if (e instanceof Error && /HTTP 404/.test(e.message)) return null;
      throw e;
    }
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/${path}`, {
        method,
        headers: {
          'X-Vault-Token': this.token,
          ...(body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `OpenBao ${method} ${path} answered HTTP ${res.status}: ${text.slice(0, 120)}`,
        );
      }
      if (method === 'DELETE' || res.status === 204) return undefined as T;
      const json = (await res.json()) as { data?: T };
      return (json.data ?? json) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
