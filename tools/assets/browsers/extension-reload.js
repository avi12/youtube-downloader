async (extensionId) => {
  const call = (api, method, ...args) =>
    new Promise((resolve) => chrome[api][method](...args, resolve))
  await call('developerPrivate', 'updateProfileConfiguration', { inDeveloperMode: true })
  await call('developerPrivate', 'reload', extensionId, { failQuietly: true })
  const infos = await call('developerPrivate', 'getExtensionsInfo', { includeDisabled: true })
  const info = infos.find((candidate) => candidate.id === extensionId)
  if (info?.state !== 'ENABLED') {await call('management', 'setEnabled', extensionId, true)}
  return true
}
