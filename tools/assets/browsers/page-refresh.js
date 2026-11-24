async ({ pageNames, isSharedAssetChanged }) => {
  const api = globalThis.browser ?? globalThis.chrome;
  const refreshedPages = [];
  for (const view of api.extension.getViews()) {
    const name = view.location.pathname.replace(/^\//, "").replace(/\.html$/, "");
    if (view === globalThis || (!isSharedAssetChanged && !pageNames.includes(name))) {
      continue;
    }

    const isClosed = Boolean(view.frameElement);
    if (isClosed) {
      view.frameElement.remove();
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
