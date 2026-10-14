// A new Idempotency-Key per request; keepIdempotencyKey = true sends the previous key again
// (manual replay tests: same key + same body returns the stored response). (2.17)
if (pm.environment.get('keepIdempotencyKey') !== 'true' || !pm.environment.get('idempotencyKey')) {
  pm.environment.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'));
}
