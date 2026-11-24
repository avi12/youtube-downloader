async ({ contentScriptNames, patterns, startedEventSuffix, messageId }) => {
  const api = globalThis.browser ?? globalThis.chrome;
  const events = contentScriptNames.map(name => [api.runtime.id + ":" + name + startedEventSuffix, name]);
  let tornDownTabCount = 0;
  for (const tab of await api.tabs.query({
     url: patterns,
     status: "complete" 
  })) {
    if (tab.discarded) {
      continue;
    }

    await api.scripting.executeScript({
      target: {
         tabId: tab.id,
         allFrames: true 
      },
      world: "ISOLATED",
      args: [events, messageId],
      func(scriptStartedEvents, id) {
        for (const [eventName, contentScriptName] of scriptStartedEvents) {
          document.dispatchEvent(new CustomEvent(eventName, { detail: { contentScriptName, messageId: id } }));
        }
      }
    }).then(() => tornDownTabCount++, () => {});
  }
  return tornDownTabCount;
}
