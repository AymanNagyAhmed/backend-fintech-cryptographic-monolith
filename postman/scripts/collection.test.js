// Every response: the API envelope (statusCode = HTTP status, meta.requestId, UPPER_SNAKE_CASE
// error codes) and money as decimal strings. operationId is set by each request's pre-request.
const operationId = pm.variables.get('operationId');
const status = pm.response.code;
// Failures a request may answer in a normal run (e.g. the fixed dev user already exists)
const tolerated = { 'auth.register': ['EMAIL_TAKEN'] };
const MONEY_KEYS = ['amount', 'balance', 'fee', 'total'];

let body;
pm.test(`${operationId}: JSON envelope`, () => {
  body = pm.response.json();
  pm.expect(body.statusCode, 'statusCode').to.eql(status);
  pm.expect(body.meta && body.meta.requestId, 'meta.requestId').to.be.a('string');
});

if (body && status < 400) {
  pm.test(`${operationId}: success envelope`, () => {
    pm.expect(body.success).to.eql(true);
    pm.expect(body).to.have.property('data');
  });
  const walk = (value, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === 'object')
      Object.keys(value).forEach((k) => {
        if (MONEY_KEYS.includes(k))
          pm.test(`${operationId}: ${path}.${k} is a decimal string`, () =>
            pm.expect(value[k]).to.be.a('string').and.match(/^-?\d+(\.\d+)?$/),
          );
        walk(value[k], `${path}.${k}`);
      });
  };
  walk(body.data, 'data');
} else if (body) {
  pm.test(`${operationId}: failure envelope`, () => {
    pm.expect(body.success).to.eql(false);
    pm.expect(body.error.code).to.match(/^[A-Z][A-Z0-9_]*$/);
  });
  pm.test(`${operationId}: answered ${status} ${body.error.code}`, () =>
    pm.expect(tolerated[operationId] || []).to.include(body.error.code),
  );
}
