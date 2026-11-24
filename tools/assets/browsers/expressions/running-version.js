(async () => {
  await (globalThis.browser ?? globalThis.chrome).runtime.getPlatformInfo();
  return globalThis.ytdlDevBackground?.version ?? null;
})()
