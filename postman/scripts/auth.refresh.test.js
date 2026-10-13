// The old refresh token is spent; keep the rotated pair
if (pm.response.code === 200) {
  const { accessToken, refreshToken } = pm.response.json().data;
  pm.environment.set('accessToken', accessToken);
  pm.environment.set('refreshToken', refreshToken);
}
