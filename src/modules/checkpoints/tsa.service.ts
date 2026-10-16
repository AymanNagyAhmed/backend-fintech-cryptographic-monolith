import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { sthCanonicalBytes, type SthPayload } from './sth-payload.js';

export interface TsaStampResult {
  token: Buffer;
  /** GenTime from the TSTInfo when parseable. */
  genTime?: Date;
}

/**
 * RFC 3161 timestamp authority client (A-B10.5). Requests a token over the
 * canonical STH bytes and stores it once on `audit.tree_heads.tsa_token`.
 */
@Injectable()
export class TsaService {
  private readonly logger = new Logger(TsaService.name);
  private readonly tsaUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.tsaUrl = config.get('TSA_URL', { infer: true });
  }

  /** Build a TimeStampReq (SHA-256 imprint, certReq=true) and POST to TSA_URL. */
  async requestToken(payload: SthPayload): Promise<TsaStampResult> {
    const imprint = createHash('sha256')
      .update(sthCanonicalBytes(payload))
      .digest();
    const request = new pkijs.TimeStampReq({
      version: 1,
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: '2.16.840.1.101.3.4.2.1', // SHA-256
        }),
        hashedMessage: new asn1js.OctetString({ valueHex: imprint }),
      }),
      certReq: true,
      nonce: new asn1js.Integer({
        valueHex: createHash('sha256')
          .update(String(Date.now()))
          .digest()
          .subarray(0, 8),
      }),
    });
    const body = Buffer.from(request.toSchema().toBER(false));
    const res = await fetch(this.tsaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        Accept: 'application/timestamp-reply',
      },
      body,
    });
    if (!res.ok)
      throw new Error(`TSA HTTP ${res.status} from ${this.tsaUrl}`);
    const token = Buffer.from(await res.arrayBuffer());
    const genTime = parseGenTime(token);
    return { token, genTime };
  }

  /** One-time fill of tsa_token on an STH row (append-only trigger allows only this). */
  async stampTreeHead(sthId: string, payload: SthPayload): Promise<void> {
    const existing = await this.prisma.treeHead.findUnique({
      where: { id: sthId },
      select: { tsaToken: true },
    });
    if (existing?.tsaToken) return;
    const { token, genTime } = await this.requestToken(payload);
    await this.prisma.treeHead.update({
      where: { id: sthId },
      data: { tsaToken: new Uint8Array(token) },
    });
    this.logger.log(
      { sthId, bytes: token.length, genTime: genTime?.toISOString() },
      'RFC 3161 TSA token stored',
    );
  }
}

function parseGenTime(token: Buffer): Date | undefined {
  try {
    const asn1 = asn1js.fromBER(token);
    if (asn1.offset === -1) return undefined;
    const resp = new pkijs.TimeStampResp({ schema: asn1.result });
    const info = resp.timeStampToken?.content as
      | { encapContentInfo?: { eContent?: { valueBlock?: { valueHex?: ArrayBuffer } } } }
      | undefined;
    const eContent = info?.encapContentInfo?.eContent?.valueBlock?.valueHex;
    if (!eContent) return undefined;
    const tstAsn1 = asn1js.fromBER(eContent);
    if (tstAsn1.offset === -1) return undefined;
    const tst = new pkijs.TSTInfo({ schema: tstAsn1.result });
    return tst.genTime;
  } catch {
    return undefined;
  }
}
