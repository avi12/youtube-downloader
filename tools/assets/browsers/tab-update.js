async ({ mainWorldPatterns, isolatedContentScripts }, replayHandshakes) => {
  const api = globalThis.browser ?? globalThis.chrome;
  const reloadedTabIds = new Set();
  const reinjectedTabIds = new Set();
  const fallbackReloadedTabIds = new Set();
  const fallbackReloads = [];
  if (mainWorldPatterns.length) {
    for (const tab of await api.tabs.query({ url: mainWorldPatterns })) {
      await api.tabs.reload(tab.id);
      reloadedTabIds.add(tab.id);
    }
  }

  for (const entry of isolatedContentScripts) {
    for (const tab of await api.tabs.query({
       url: entry.matches,
       status: "complete" 
    })) {
      if (tab.discarded || reloadedTabIds.has(tab.id) || fallbackReloadedTabIds.has(tab.id)) {
        continue;
      }

      const target = {
         tabId: tab.id,
         allFrames: entry.isAllFrames 
      };
      try {
        if (entry.css.length) {
          await api.scripting.removeCSS({
             target,
             files: entry.css 
          }).catch(() => {});
          await api.scripting.insertCSS({
             target,
             files: entry.css 
          });
        }

        await api.scripting.executeScript({
           target,
           files: entry.js,
           world: "ISOLATED",
           injectImmediately: true 
        });
        reinjectedTabIds.add(tab.id);
      } catch (error) {
        fallbackReloads.push({
           url: tab.url,
           message: String(error?.message ?? error) 
        });
        reinjectedTabIds.delete(tab.id);
        fallbackReloadedTabIds.add(tab.id);
        await api.tabs.reload(tab.id);
      }
    }
  }

  let replayedHandshakeCount = 0;
  for (const tabId of reinjectedTabIds) {
    const [injection] = await api.scripting.executeScript({
      target: {
         tabId 
      },
      world: "MAIN",
      func: replayHandshakes
    }).catch(() => []);
    replayedHandshakeCount += injection?.result ?? 0;
  }

  return {
    reloadedTabCount: reloadedTabIds.size,
    reinjectedTabCount: reinjectedTabIds.size,
    replayedHandshakeCount,
    fallbackReloads
  };
}
