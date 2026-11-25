async ({ pageNames, isSharedAssetChanged }) => {
  const api = globalThis.browser ?? globalThis.chrome;
  const refreshedPages = [];
  // Removing a processing frame would kill the downloads in it
  const removeOnceIdle = async frame => {
    const { statusProgress = {} } = await api.storage.local.get("statusProgress");
    const isDownloading = Object.values(statusProgress).some(entry => entry.isDownloading);
    if (isDownloading) {
      setTimeout(() => removeOnceIdle(frame), 2000);
      return;
    }

    frame.remove();
  };
  for (const view of api.extension.getViews()) {
    const name = view.location.pathname.replace(/^\//, "").replace(/\.html$/, "");
    if (view === globalThis || (!isSharedAssetChanged && !pageNames.includes(name))) {
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
