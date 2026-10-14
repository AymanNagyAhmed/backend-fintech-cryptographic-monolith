// 201: store transferId, then send the same body with the same Idempotency-Key again: it must
// replay the stored transfer (Idempotent-Replayed: true) instead of moving money twice. (2.17)
const expected = pm.variables.get('expectedErrorCode');
if (expected) {
  pm.test(`transfers.create: ${expected} for a wallet without funds`, () =>
    pm.expect(pm.response.json().error.code).to.eql(expected),
  );
} else {
  pm.test('transfers.create: 201 Created', () => pm.expect(pm.response.code).to.eql(201));
}

if (pm.response.code === 201) {
  const transfer = pm.response.json().data;
  pm.environment.set('transferId', transfer.id);
  pm.test('transfers.create: first request is not a replay', () =>
    pm.expect(pm.response.headers.has('Idempotent-Replayed')).to.eql(false),
  );
  pm.sendRequest(
    {
      url: `${pm.environment.get('baseUrl')}/transfers`,
      method: 'POST',
      header: [
        { key: 'Authorization', value: `Bearer ${pm.environment.get('accessToken')}` },
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Idempotency-Key', value: pm.environment.get('idempotencyKey') },
      ],
      body: { mode: 'raw', raw: pm.variables.replaceIn(pm.request.body.raw) },
    },
    (err, replay) => {
      pm.test('transfers.create: same Idempotency-Key replays the same transfer', () => {
        pm.expect(err).to.eql(null);
        pm.expect(replay.code).to.eql(201);
        pm.expect(replay.headers.get('Idempotent-Replayed')).to.eql('true');
        pm.expect(replay.json().data).to.eql(transfer);
      });
    },
  );
}

// Set by the pre-request script for this request only; local variables live for the whole run
pm.variables.unset('walletId');
pm.variables.unset('expectedErrorCode');
