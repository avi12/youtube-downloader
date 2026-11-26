async ({ pageNames, isSharedAssetChanged }, isDownloading) => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Opened anew for every download, so the next one loads a new build
  const PER_DOWNLOAD_PAGE = "download-worker";
  const refreshedPages = [];
  // Removing a processing frame would kill the downloads in it
  const removeOnceIdle = async frame => {
    if (await isDownloading()) {
      const retry = () => {
        api.storage.local.onChanged.removeListener(retry);
        removeOnceIdle(frame);
      };
      api.storage.local.onChanged.addListener(retry);
      return;
    }

    frame.remove();
  };
  for (const view of api.extension.getViews()) {
    const name = view.location.pathname.replace(/^\//, "").replace(/\.html$/, "");
    const isUntouched = view === globalThis || name === PER_DOWNLOAD_PAGE;
    if (isUntouched || (!isSharedAssetChanged && !pageNames.includes(name))) {
      continue;
    }

    const isClosed = Boolean(view.frameElement);
    if (isClosed) {
      removeOnceIdle(view.frameElement);
    } else {
      view.location.reload();
    }

    refreshedPages.push({
       name,
       isClosed 
    });
  }
  return refreshedPages;
}
