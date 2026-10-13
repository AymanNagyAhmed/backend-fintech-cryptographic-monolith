// Shared by build-collection.ts and check-coverage.ts: read the OpenAPI document of the running
// dev server and list its operations.
import { createHash } from 'node:crypto';

export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/** `<context>.<action>`, e.g. `auth.login`, `wallets.create`. */
export const OPERATION_ID = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  security?: Record<string, string[]>[];
  [key: string]: unknown;
}

export interface Operation {
  method: string;
  /** OpenAPI path, e.g. `/v1/wallets/{id}` */
  path: string;
  operationId: string | undefined;
  summary: string | undefined;
  tag: string | undefined;
  /** No security requirement: public or signed request (no Bearer token) */
  isPublic: boolean;
  /** Query parameters that are not required (shown but disabled in Postman) */
  optionalQuery: string[];
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
}

export const defaultSpecUrl = () =>
  `${process.env.API ?? 'http://localhost:3000/v1'}/docs-json`;

export async function fetchSpec(url: string): Promise<OpenApiDocument> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      `Cannot reach ${url}; start the dev server first (make -C $MM dev)`,
    );
  }
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return (await res.json()) as OpenApiDocument;
}

export function listOperations(spec: OpenApiDocument): Operation[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    // Spec order (controller order), e.g. POST /wallets before GET /wallets
    Object.keys(item)
      .filter((m) => (HTTP_METHODS as readonly string[]).includes(m))
      .map((method) => {
        const op = item[method] as OpenApiOperation;
        const security = op.security ?? spec.security ?? [];
        return {
          method: method.toUpperCase(),
          path,
          operationId: op.operationId,
          summary: op.summary,
          tag: op.tags?.[0],
          isPublic: security.length === 0,
          optionalQuery: ((op.parameters ?? []) as OpenApiParameter[])
            .filter((p) => p.in === 'query' && !p.required)
            .map((p) => p.name),
        };
      }),
  );
}

/** Same input, same UUID: collection, folder and request ids do not change between builds. */
export function stableId(seed: string): string {
  const h = createHash('sha256')
    .update(`fintech-monolith:${seed}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Postman URL path segments after the `/v1` prefix (baseUrl ends in /v1), `{id}` -> `:id`. */
export function postmanPath(openApiPath: string): string[] {
  return openApiPath
    .split('/')
    .filter(Boolean)
    .slice(1)
    .map((s) => s.replace(/^\{(.+)\}$/, ':$1'));
}
