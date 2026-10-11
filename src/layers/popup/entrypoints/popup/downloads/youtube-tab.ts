const YOUTUBE_TAB_URL_PATTERN = "*://*.youtube.com/*";
const PAGE_IDENTITY_PARAMS = ["v", "list"];

function isSamePage(candidateUrl: string, targetUrl: URL) {
  const candidate = URL.parse(candidateUrl);
  if (!candidate || candidate.pathname !== targetUrl.pathname) {
    return false;
  }

  return PAGE_IDENTITY_PARAMS
    .filter(param => targetUrl.searchParams.has(param))
    .every(param => candidate.searchParams.get(param) === targetUrl.searchParams.get(param));
}

type FocusTabParams = {
  id?: number;
  windowId: number;
};
export async function focusTab({ id, windowId }: FocusTabParams) {
  await browser.tabs.update(id, { active: true });
  await browser.windows.update(windowId, { focused: true });
}

export async function focusOrOpenTab(url: string) {
  const targetUrl = new URL(url);
  const tabs = await browser.tabs.query({ url: YOUTUBE_TAB_URL_PATTERN });
  const existingTab = tabs.find(tab => tab.url && isSamePage(tab.url, targetUrl));
  if (!existingTab) {
    await browser.tabs.create({ url });
    return;
  }

  await focusTab(existingTab);
}
