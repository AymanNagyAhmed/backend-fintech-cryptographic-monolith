# 032. Scalability under Market Volatility

```mermaid
flowchart LR
  subgraph impactPath [Impact]
    syncAudit[Signing and anchoring on the transfer request] --> timeout[p99 collapses when volume spikes]
  end
  subgraph solutionPath [Recommended solution]
    outbox[Outbox in the money transaction] --> worker[Workers chain and sign off the request]
  end
```

## Problem

A volatility spike is when the ledger is busiest and when users retry the most. Doing Merkle trees, HSM signatures, and object-storage writes inside `POST /v1/transfers` makes that spike also an audit spike. A single hash chain that every event appends to becomes a global lock.

## Impact

- Transfers time out, clients retry, and idempotency is the only thing preventing duplicate posts.
- The HSM queue backs up and withdrawals stall behind audit signatures.
- One busy partition blocks unrelated currencies.
- Operators scale the database when the bottleneck is the synchronous signature.

## Recommended solution

The money transaction writes the business rows and an outbox row, then returns. Workers chain audit events per partition, and only checkpoints are signed. Throughput can grow with partitions. The build plan's check is that p99 of `POST /v1/transfers` with audit enabled stays inside budget versus audit disabled, and that an audit backlog does not block requests. Rate limits keep a single client from consuming the pool. Add capacity for the ledger and the workers before adding a second write path.

## Code

```mermaid
flowchart TD
  http["POST /v1/transfers"] --> tx["Ledger post and transfer.completed outbox row"]
  tx --> ret["HTTP response returns"]
  worker["ChainerProcessor"] --> drain["chainer.run off the request"]
  drain --> alert["Lag alert does not block HTTP"]
  sth["CheckpointerService"] --> sign["Sign the checkpoint, not every event"]
```

`TransfersService` enqueues `transfer.completed` on the same transaction as the ledger post, then the HTTP handler returns. `ChainerProcessor` drains that outbox on a BullMQ worker. Its comment states the lag alert never blocks HTTP. Checkpoint signing stays in `CheckpointerService`, off the transfer request.

```typescript
await this.outbox.enqueue(tx, 'ledger', {
  type: 'transfer.completed',
  schemaVersion: 1,
  occurredAt: dtoOut.createdAt,
  actor: { subjectRef: userId },
  ...(requestId !== undefined ? { requestId } : {}),
  partitionKey: auditPartitionKey(row.id, this.partitionCount),
  transferId: row.id,
  sourceWalletId: from.id,
  destinationWalletId: to.id,
  currency: amount.currency,
  amount: amount.toString(),
});
```

```typescript
async process(_job: Job): Promise<ChainerRunResult> {
  const result = await this.chainer.run();
  this.metrics.recordChainer(result);
  // Alert only; never blocks HTTP (2.5 / A-B9.7)
  await this.outboxLag.checkAndAlert();
  return result;
}
```
