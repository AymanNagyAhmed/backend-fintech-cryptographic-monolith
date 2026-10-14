if (pm.response.code === 201) {
  const wallet = pm.response.json().data;
  pm.environment.set('walletId', wallet.id);
  pm.test('wallets.create: new wallet starts at zero', () =>
    pm.expect(Number(wallet.balance)).to.eql(0),
  );
}
