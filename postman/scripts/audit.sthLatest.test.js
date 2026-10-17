if (pm.response.code === 200) {
  const body = pm.response.json();
  const treeSize = body?.data?.treeSize;
  if (treeSize != null) pm.environment.set('sthTreeSize', String(treeSize));
}
