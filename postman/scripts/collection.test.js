// Every response: the API envelope (statusCode = HTTP status, meta.requestId, UPPER_SNAKE_CASE
// error codes) and money as decimal strings. operationId is set by each request's pre-request.
const operationId = pm.variables.get('operationId');
const status = pm.response.code;
// Failures a request may answer in a normal run (e.g. the fixed dev user already exists)
const tolerated = {
  'auth.register': ['EMAIL_TAKEN'],
  // Allow-list confirm without an enrolled TOTP in the Newman smoke env
  'withdrawals.beneficiaryConfirm': ['INVALID_TOTP', 'TOTP_REQUIRED'],
  // Privileged audit/compliance routes need MFA compliance user
  'audit.verify': ['FORBIDDEN', 'UNAUTHORIZED'],
  'audit.sthLatest': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'],
  'audit.sthBySize': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'],
  'audit.proof': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'],
  'audit.consistency': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND', 'BAD_REQUEST'],
  'privacy.erasureRequest': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'],
  'privacy.erasureApprove': ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'],
  'compliance.export': ['FORBIDDEN', 'UNAUTHORIZED'],
  'compliance.search': ['FORBIDDEN', 'UNAUTHORIZED'],
  'reserves.proofMe': ['NOT_FOUND', 'RESERVES_SNAPSHOT_NOT_FOUND', 'RESERVES_LEAF_NOT_FOUND'],
  'reserves.compare': [
    'FORBIDDEN',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'RESERVES_SNAPSHOT_NOT_FOUND',
    'RESERVES_UNDER_COLLATERALIZED',
  ],
};
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
  // A request's pre-request script may announce the failure it expects
  const expected = [
    ...(tolerated[operationId] || []),
    pm.variables.get('expectedErrorCode'),
    pm.variables.get('expectedErrorCodeAlt'),
  ].filter(Boolean);
  pm.test(`${operationId}: answered ${status} ${body.error.code}`, () =>
    pm.expect(expected).to.include(body.error.code),
  );
}
