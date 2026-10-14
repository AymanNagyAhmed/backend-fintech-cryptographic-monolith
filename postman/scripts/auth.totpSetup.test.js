if (pm.response.code === 200) pm.environment.set('totpSecret', pm.response.json().data.secret);
