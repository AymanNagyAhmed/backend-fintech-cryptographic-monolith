// A provider redelivers an event it thinks failed: the same signed request answers 200 again. (2.17)
if (pm.response.code === 200) {
  const first = pm.response.json().data;
  pm.test('webhooks.receive: receipt names the event', () =>
    pm.expect(first.eventId).to.eql(pm.environment.get('webhookEventId')),
  );
  pm.sendRequest(
    {
      url: pm.request.url.toString(),
      method: 'POST',
      header: pm.request.headers.toObject(),
      body: { mode: 'raw', raw: pm.request.body.raw },
    },
    (err, res) => {
      pm.test('webhooks.receive: redelivery answers 200 with the same receipt', () => {
        pm.expect(err).to.eql(null);
        pm.expect(res.code).to.eql(200);
        pm.expect(res.json().data).to.eql(first);
      });
    },
  );
}
