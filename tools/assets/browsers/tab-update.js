async ({ mainWorldPatterns, isolatedContentScripts, swappableMainWorldScripts }, replayHandshakes) => {
  const api = globalThis.browser ?? globalThis.chrome;
  // Tabs are never reloaded: whatever can't be updated in place is only reported
  const staleTabIds = new Set();
  const reinjectedTabIds = new Set();
  const swappedTabIds = new Set();
  const failedInjections = [];
  if (mainWorldPatterns.length) {
    for (const tab of await api.tabs.query({ url: mainWorldPatterns })) {
      staleTabIds.add(tab.id);
    }
  }

  const injections = [
    ...swappableMainWorldScripts.map(entry => ({
       entry,
       world: "MAIN",
       updatedTabIds: swappedTabIds
    })),
    ...isolatedContentScripts.map(entry => ({
       entry,
       world: "ISOLATED",
       updatedTabIds: reinjectedTabIds
    }))
  ];
  for (const { entry, world, updatedTabIds } of injections) {
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
           world,
           injectImmediately: true 
        });
        updatedTabIds.add(tab.id);
      } catch (error) {
        failedInjections.push({
           url: tab.url,
           message: String(error?.message ?? error) 
        });
        updatedTabIds.delete(tab.id);
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
    swappedTabCount: swappedTabIds.size,
    replayedHandshakeCount,
    failedInjections
  };
}
