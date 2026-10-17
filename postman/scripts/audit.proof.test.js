const body = pm.response.json();
if (pm.response.code === 200) {
  pm.test('inclusion proof verifies against the published STH', () => {
    pm.expect(body?.data?.verified).to.eql(true);
  });
}
