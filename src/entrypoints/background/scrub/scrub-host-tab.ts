const SCRUB_HOST_URL = "https://www.youtube.com/?ytdlScrubHost=1";

let scrubHostTabId: number | null = null;

browser.tabs.onRemoved.addListener(tabId => {
  if (tabId === scrubHostTabId) {
    scrubHostTabId = null;
  }
});

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise(resolve => {
    function onUpdated(updatedTabId: number, changeInfo: { status?: string }) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function ensureScrubHostTab(): Promise<number> {
  if (scrubHostTabId !== null) {
    try {
      await browser.tabs.get(scrubHostTabId);
      return scrubHostTabId;
    } catch {
      scrubHostTabId = null;
    }
  }

  const tab = await browser.tabs.create({
    url: SCRUB_HOST_URL,
    active: false
  });
  scrubHostTabId = tab.id!;
  await waitForTabComplete(scrubHostTabId);
  return scrubHostTabId;
}
