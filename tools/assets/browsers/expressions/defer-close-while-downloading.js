(async () => {
  const isDownloading = async () => {
    const { statusProgress = {} } = await chrome.storage.local.get("statusProgress");
    return Object.values(statusProgress).some(entry => entry.isDownloading);
  };
  if (!await isDownloading()) {
    return false;
  }

  globalThis.ytdlDevPendingClose ??= (async () => {
    while (await isDownloading()) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    globalThis.ytdlDevPendingClose = undefined;
    await chrome.offscreen.closeDocument();
  })();
  return true;
})()
