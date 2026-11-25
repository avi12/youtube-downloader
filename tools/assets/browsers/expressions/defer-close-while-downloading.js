async isDownloading => {
  if (!await isDownloading()) {
    return false;
  }

  if (!globalThis.ytdlDevPendingClose) {
    globalThis.ytdlDevPendingClose = async () => {
      if (await isDownloading()) {
        return;
      }

      chrome.storage.local.onChanged.removeListener(globalThis.ytdlDevPendingClose);
      globalThis.ytdlDevPendingClose = undefined;
      await chrome.offscreen.closeDocument();
    };
    chrome.storage.local.onChanged.addListener(globalThis.ytdlDevPendingClose);
  }

  return true;
}
