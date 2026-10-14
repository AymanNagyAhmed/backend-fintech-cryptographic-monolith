// Source: the caller's wallet in {{currency}} with the highest balance (a seeded user has funded
// wallets); a new user only has the empty {{walletId}}, so the transfer must answer
// INSUFFICIENT_FUNDS. Target: another wallet in {{currency}}, created when there is none.
// Balances are compared as integers of 1e-8 units, never as floats.
const baseUrl = pm.environment.get('baseUrl');
const currency = pm.environment.get('currency');
const auth = { key: 'Authorization', value: `Bearer ${pm.environment.get('accessToken')}` };
const units = (s) => {
  const [int, frac = ''] = String(s).split('.');
  return BigInt(int + frac.padEnd(8, '0').slice(0, 8));
};
const needed = units(pm.environment.get('amount'));

pm.sendRequest({ url: `${baseUrl}/wallets?limit=100`, method: 'GET', header: [auth] }, (err, res) => {
  if (err) throw err;
  const wallets = res.json().data.items.filter((w) => w.currency === currency && w.status === 'active');
  const richest = wallets.reduce((a, b) => (!a || units(b.balance) > units(a.balance) ? b : a), null);
  const funded = richest && units(richest.balance) >= needed;
  const source = funded ? richest : wallets.find((w) => w.id === pm.environment.get('walletId'));
  if (!source) throw new Error(`transfers.create: no ${currency} wallet; run wallets.create first`);
  pm.variables.set('walletId', source.id); // this request only; the environment keeps its walletId
  pm.variables.set('expectedErrorCode', funded ? '' : 'INSUFFICIENT_FUNDS');

  const target = wallets.find((w) => w.id !== source.id);
  if (target) return pm.environment.set('counterpartyWalletId', target.id);
  pm.sendRequest(
    {
      url: `${baseUrl}/wallets`,
      method: 'POST',
      header: [auth, { key: 'Content-Type', value: 'application/json' }],
      body: { mode: 'raw', raw: JSON.stringify({ currency, label: 'Counterparty' }) },
    },
    (e, created) => {
      if (e) throw e;
      pm.environment.set('counterpartyWalletId', created.json().data.id);
    },
  );
});
