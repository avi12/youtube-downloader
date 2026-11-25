async ({ mainWorldPatterns, isolatedContentScripts }, replayHandshakes) => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Tabs are never reloaded: whatever can't be updated in place is only reported
  const staleTabIds = new Set();
  const reinjectedTabIds = new Set();
  const failedInjections = [];
  if (mainWorldPatterns.length) {
    for (const tab of await api.tabs.query({ url: mainWorldPatterns })) {
      staleTabIds.add(tab.id);
    }
  }

  for (const entry of isolatedContentScripts) {
    for (const tab of await api.tabs.query({
       url: entry.matches,
       status: "complete" 
    })) {
      if (tab.discarded) {
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
        failedInjections.push({
           url: tab.url,
           message: String(error?.message ?? error) 
        });
        reinjectedTabIds.delete(tab.id);
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
    staleTabCount: staleTabIds.size,
    reinjectedTabCount: reinjectedTabIds.size,
    replayedHandshakeCount,
    failedInjections
  };
}
