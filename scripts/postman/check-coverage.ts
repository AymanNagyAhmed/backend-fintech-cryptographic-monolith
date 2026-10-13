// Fails when an OpenAPI operation has no operationId (`<context>.<action>`), tag or summary,
// when operationIds repeat, or when the collection and the spec list different operations.
//   npm run postman:check [-- --spec <url> --collection <file>]
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  defaultSpecUrl,
  fetchSpec,
  listOperations,
  OPERATION_ID,
  stableId,
} from './openapi.js';

const { values: args } = parseArgs({
  options: {
    spec: { type: 'string', default: defaultSpecUrl() },
    collection: {
      type: 'string',
      default: 'postman/fintech-monolith.postman_collection.json',
    },
  },
});

interface CollectionItem {
  id?: string;
  name?: string;
  item?: CollectionItem[];
}

function requestIds(items: CollectionItem[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const it of items) {
    if (it.item) for (const [k, v] of requestIds(it.item)) ids.set(k, v);
    else if (it.id) ids.set(it.id, it.name ?? '');
  }
  return ids;
}

async function main() {
  const ops = listOperations(await fetchSpec(args.spec));
  const collection = JSON.parse(readFileSync(args.collection, 'utf8')) as {
    item: CollectionItem[];
  };
  const inCollection = requestIds(collection.item);
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const op of ops) {
    const where = `${op.method} ${op.path}`;
    if (!op.operationId || !OPERATION_ID.test(op.operationId))
      problems.push(
        `${where}: operationId "${op.operationId ?? ''}" is not <context>.<action>`,
      );
    if (!op.tag) problems.push(`${where}: no @ApiTags`);
    if (!op.summary) problems.push(`${where}: no summary in @ApiOperation`);
    if (!op.operationId) continue;
    if (seen.has(op.operationId))
      problems.push(`${where}: operationId ${op.operationId} is used twice`);
    seen.add(op.operationId);
    if (!inCollection.delete(stableId(op.operationId)))
      problems.push(
        `${op.operationId}: missing from ${args.collection} (npm run postman:build)`,
      );
  }
  for (const name of inCollection.values())
    problems.push(
      `"${name}": in the collection but not in the spec (npm run postman:build)`,
    );

  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`postman:check: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`postman:check: ${ops.length} operations, all in the collection`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
