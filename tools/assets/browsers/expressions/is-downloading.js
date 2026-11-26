async () => {
  const { storage } = globalThis.browser ?? globalThis.chrome;
  const { statusProgress = {} } = await storage.local.get("statusProgress");
  return Object.values(statusProgress).some(entry => entry.isDownloading);
}
