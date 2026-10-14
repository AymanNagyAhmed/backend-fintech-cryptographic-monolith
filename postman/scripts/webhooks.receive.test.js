// A provider redelivers an event it thinks failed: the same signed request answers 200 with the
// stored receipt and Idempotent-Replayed: true, and the wallet is credited once. (2.17)
if (pm.response.code === 200) {
  const first = pm.response.json().data;
  pm.test('webhooks.receive: receipt names the event', () =>
    pm.expect(first.eventId).to.eql(pm.environment.get('webhookEventId')),
  );
  pm.test('webhooks.receive: payment.succeeded credits the wallet', () => {
    pm.expect(first.status).to.eql('credited');
    pm.expect(first.deposit.walletId).to.eql(pm.environment.get('walletId'));
  });
  pm.sendRequest(
    {
      url: pm.request.url.toString(),
      method: 'POST',
      header: pm.request.headers.toObject(),
      body: { mode: 'raw', raw: pm.request.body.raw },
    },
    (err, res) => {
      pm.test('webhooks.receive: redelivery replays the same receipt', () => {
        pm.expect(err).to.eql(null);
        pm.expect(res.code).to.eql(200);
        pm.expect(res.headers.get('Idempotent-Replayed')).to.eql('true');
        pm.expect(res.json().data).to.eql(first);
      });
    },
  );
}
