// Generates postman/fintech-monolith.postman_collection.json (Postman v2.1) from the OpenAPI
// document of the running dev server, then merges the scripts of postman/scripts/.
//   make -C $MM dev &  then  npm run postman:build [-- --spec <url> --out <file>]
// Output is deterministic (ids from operationId, sorted keys): no API change = no git diff.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { convertV2 } from 'openapi-to-postmanv2';
import {
  defaultSpecUrl,
  fetchSpec,
  listOperations,
  postmanPath,
  stableId,
  type Operation,
} from './openapi.js';

const { values: args } = parseArgs({
  options: {
    spec: { type: 'string', default: defaultSpecUrl() },
    out: {
      type: 'string',
      default: 'postman/fintech-monolith.postman_collection.json',
    },
    scripts: { type: 'string', default: 'postman/scripts' },
    name: { type: 'string', default: 'Fintech Monolith API' },
  },
});

/** Workflow order; tags not listed follow in alphabetical order. */
const FOLDER_ORDER = [
  'Health',
  'Auth',
  'Users',
  'Wallets',
  'Transfers',
  'Webhooks',
  'Withdrawals',
  'Audit',
  'Checkpoints',
  'Privacy',
  'Compliance',
  'Reserves',
  'B2B',
];

/** Request order inside a folder where the spec order does not fit the flow (logout last). */
const REQUEST_ORDER = [
  'auth.register',
  'auth.login',
  'auth.refresh',
  'auth.me',
  'auth.totpSetup',
  'auth.totpEnable',
  'auth.logout',
  'withdrawals.beneficiaryCreate',
  'withdrawals.beneficiaryList',
  'withdrawals.beneficiaryConfirm',
  'withdrawals.create',
];

/** Bodies that use environment variables instead of the DTO examples. */
const BODIES: Record<string, object> = {
  'auth.register': { email: '{{userEmail}}', password: '{{userPassword}}' },
  'auth.login': { email: '{{userEmail}}', password: '{{userPassword}}' },
  'auth.refresh': { refreshToken: '{{refreshToken}}' },
  'auth.logout': { refreshToken: '{{refreshToken}}' },
  'auth.totpEnable': { code: '{{totpCode}}' },
  'wallets.create': { currency: '{{currency}}', label: 'Savings' },
  'transfers.create': {
    fromWalletId: '{{walletId}}',
    toWalletId: '{{counterpartyWalletId}}',
    amount: '{{amount}}',
    currency: '{{currency}}',
  },
  'webhooks.receive': {
    id: '{{webhookEventId}}',
    type: 'payment.succeeded',
    data: {
      walletId: '{{walletId}}',
      amount: '{{amount}}',
      currency: '{{currency}}',
    },
  },
  'withdrawals.create': {
    walletId: '{{walletId}}',
    beneficiaryId: '{{beneficiaryId}}',
    amount: '{{amount}}',
    currency: '{{currency}}',
    totpCode: '{{totpCode}}',
  },
  'withdrawals.beneficiaryCreate': {
    label: 'Cold wallet',
    currency: 'BTC',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    network: 'bitcoin',
  },
  'withdrawals.beneficiaryConfirm': {
    totpCode: '{{totpCode}}',
  },
  'reserves.compare': {
    currency: '{{currency}}',
    reserves: '10000.00',
  },
};

/** Header values taken from the environment (set by the collection pre-request script). */
const HEADER_VALUES: Record<string, string> = {
  'idempotency-key': '{{idempotencyKey}}',
};

/** Stable query examples (openapi-to-postman invents random floats for bare number schemas). */
const QUERY_VALUES: Record<string, string> = {
  from: '{{sthFrom}}',
  to: '{{sthTo}}',
  limit: '20',
  cursor: '',
  partition: '',
  partitionKey: '',
  type: '',
  subjectRef: '',
  treeSize: '{{sthTreeSize}}',
  currency: '{{currency}}',
};

/** Path variables by context (operationId prefix). */
const PATH_VARIABLES: Record<string, Record<string, string>> = {
  wallets: { id: '{{walletId}}' },
  webhooks: { provider: '{{webhookProvider}}' },
  withdrawals: { id: '{{beneficiaryId}}' },
  audit: { eventId: '{{auditEventId}}', treeSize: '{{sthTreeSize}}' },
  privacy: { userId: '{{userId}}', requestId: '{{erasureRequestId}}' },
};

/** Folder-level pre-request scripts. */
const FOLDER_SCRIPTS: Record<string, string> = {
  B2B: 'signed-request.pre-request.js',
  Webhooks: 'webhook-signature.pre-request.js',
};

/** Set by the folder script, so the static example values are dropped. */
const SIGNED_HEADERS = ['x-client-id', 'x-timestamp', 'x-nonce', 'x-signature'];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Item = Record<string, any>;

function readScript(file: string): string[] | undefined {
  const path = join(args.scripts, file);
  if (!existsSync(path)) return undefined;
  const source = readFileSync(path, 'utf8').replace(
    /^\/\/ @include (\S+)$/gm,
    (_, lib: string) =>
      readFileSync(join(args.scripts, 'lib', `${lib}.js`), 'utf8').trimEnd(),
  );
  return source.trimEnd().split('\n');
}

const event = (listen: 'prerequest' | 'test', exec: string[]) => ({
  listen,
  script: { type: 'text/javascript', exec },
});

function events(prefix: string, pre: string[] = []) {
  const preRequest = [
    ...pre,
    ...(readScript(`${prefix}.pre-request.js`) ?? []),
  ];
  const test = readScript(`${prefix}.test.js`);
  return [
    ...(preRequest.length ? [event('prerequest', preRequest)] : []),
    ...(test ? [event('test', test)] : []),
  ];
}

function convert(spec: object): Promise<Item> {
  return new Promise((resolve, reject) =>
    convertV2(
      { type: 'json', data: spec },
      {
        folderStrategy: 'Tags',
        parametersResolution: 'Example',
        requestNameSource: 'Fallback',
        alwaysInheritAuthentication: true,
        enableOptionalParameters: true,
      },
      (err, result) => {
        if (err) return reject(new Error(err.message));
        const data = result?.output?.[0]?.data;
        if (!result?.result || !data)
          return reject(new Error(result?.reason ?? 'conversion failed'));
        resolve(data as Item);
      },
    ),
  );
}

const keyOf = (method: string, path: string) =>
  `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`;

function rewriteRequest(item: Item, op: Operation & { operationId: string }) {
  const req = item.request;
  const context = op.operationId.split('.')[0];
  const path = postmanPath(op.path);
  const vars = PATH_VARIABLES[context] ?? {};
  const query = ((req.url.query ?? []) as Item[]).map((q) => {
    const key = String(q.key);
    return {
      key,
      value: QUERY_VALUES[key] ?? q.value,
      description: q.description,
      disabled: op.optionalQuery.includes(key),
    };
  });
  const enabled = query.filter((q) => !q.disabled && q.value !== '');
  req.url = {
    raw:
      `{{baseUrl}}/${path.join('/')}` +
      (enabled.length
        ? `?${enabled.map((q) => `${q.key}=${q.value}`).join('&')}`
        : ''),
    host: ['{{baseUrl}}'],
    path,
    ...(query.length ? { query } : {}),
    ...(req.url.variable?.length
      ? {
          variable: (req.url.variable as Item[]).map((v) => ({
            key: v.key,
            value: vars[v.key] ?? v.value,
            description: v.description,
          })),
        }
      : {}),
  };
  req.header = ((req.header ?? []) as Item[])
    .filter((h) => !SIGNED_HEADERS.includes(String(h.key).toLowerCase()))
    .map((h) => {
      const value = HEADER_VALUES[String(h.key).toLowerCase()];
      return value ? { ...h, value } : h;
    });
  const body = BODIES[op.operationId];
  if (body && req.body?.mode === 'raw')
    req.body.raw = JSON.stringify(body, null, 2);
  if (op.isPublic) req.auth = { type: 'noauth' };
  else delete req.auth;
  req.description = op.summary ?? '';

  return {
    id: stableId(op.operationId),
    name: op.summary ?? op.operationId,
    request: req,
    // Status-only examples: openapi-to-postmanv2 invents random UUIDs/dates in bodies,
    // which would make every regenerate a git diff (A-B17 Done-when).
    response: ((item.response ?? []) as Item[]).map((r) => ({
      id: stableId(`${op.operationId}:${r.code}`),
      name: r.name,
      code: r.code,
      status: r.status,
      header: r.header,
      _postman_previewlanguage: r._postman_previewlanguage,
    })),
    event: events(op.operationId, [
      `pm.variables.set('operationId', '${op.operationId}');`,
    ]),
    ...(item.protocolProfileBehavior
      ? { protocolProfileBehavior: item.protocolProfileBehavior }
      : {}),
  };
}

const folderRank = (tag: string) => {
  const i = FOLDER_ORDER.indexOf(tag);
  return i === -1 ? FOLDER_ORDER.length : i;
};
const requestRank = (id: string) => {
  const i = REQUEST_ORDER.indexOf(id);
  return i === -1 ? REQUEST_ORDER.length : i;
};

function sortKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => (value as Item)[k] !== undefined)
        .sort()
        .map((k) => [k, sortKeys((value as Item)[k])]),
    );
  return value as Json;
}

async function main() {
  const spec = await fetchSpec(args.spec);
  const ops = listOperations(spec);
  const missing = ops.filter((o) => !o.operationId || !o.tag);
  if (missing.length)
    throw new Error(
      `Operations without operationId or tag: ${missing.map((o) => keyOf(o.method, o.path)).join(', ')} (run npm run postman:check)`,
    );
  const byKey = new Map(ops.map((o) => [keyOf(o.method, o.path), o]));

  const converted = await convert(spec);
  const items: { tag: string; opId: string; item: object }[] = [];
  const walk = (list: Item[]) => {
    for (const it of list) {
      if (it.item) walk(it.item as Item[]);
      else {
        const key = keyOf(
          it.request.method as string,
          `/${(it.request.url.path as string[]).join('/')}`,
        );
        const op = byKey.get(key);
        if (!op) throw new Error(`Converted request ${key} is not in the spec`);
        const typed = op as Operation & { operationId: string; tag: string };
        items.push({
          tag: typed.tag,
          opId: typed.operationId,
          item: rewriteRequest(it, typed),
        });
      }
    }
  };
  walk(converted.item as Item[]);

  const specOrder = ops.map((o) => o.operationId);
  const tags = [...new Set(items.map((i) => i.tag))].sort(
    (a, b) => folderRank(a) - folderRank(b) || a.localeCompare(b),
  );
  const folders = tags.map((tag) => ({
    id: stableId(`folder:${tag}`),
    name: tag,
    item: items
      .filter((i) => i.tag === tag)
      .sort(
        (a, b) =>
          requestRank(a.opId) - requestRank(b.opId) ||
          specOrder.indexOf(a.opId) - specOrder.indexOf(b.opId),
      )
      .map((i) => i.item),
    event: FOLDER_SCRIPTS[tag]
      ? [event('prerequest', readScript(FOLDER_SCRIPTS[tag]) ?? [])]
      : [],
  }));

  const collection = {
    info: {
      _postman_id: stableId('collection'),
      name: args.name,
      description: (spec.info as Item | undefined)?.description,
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    event: events('collection'),
    item: folders,
  };
  writeFileSync(args.out, `${JSON.stringify(sortKeys(collection), null, 2)}\n`);
  console.log(
    `${args.out}: ${items.length} requests in ${folders.length} folders (${folders.map((f) => f.name).join(', ')})`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
