// freshUser = true (Newman runs): a new user per run, so wallet limits and TOTP state never carry over
if (pm.environment.get('freshUser') === 'true') {
  pm.environment.set('userEmail', `newman-${pm.variables.replaceIn('{{$guid}}')}@example.com`);
  pm.environment.unset('totpSecret');
}
