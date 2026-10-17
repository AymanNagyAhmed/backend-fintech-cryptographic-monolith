// Store the allow-list entry id for confirm / later withdrawal flows.
const body = pm.response.json();
const id = body?.data?.id;
if (id) pm.environment.set('beneficiaryId', id);
