const SABR_ORIGIN_RULE_ID = 1;
const SABR_RULE_PRIORITY = 1;
const YOUTUBE_ORIGIN = "https://www.youtube.com";
const YOUTUBE_REFERER = "https://www.youtube.com/";
const GOOGLEVIDEO_URL_FILTER = "||googlevideo.com/videoplayback";
const SEC_FETCH_SITE_HEADER = "Sec-Fetch-Site";
const SEC_FETCH_STORAGE_ACCESS_HEADER = "Sec-Fetch-Storage-Access";
const SEC_FETCH_SITE_CROSS_SITE = "cross-site";
const SEC_FETCH_STORAGE_ACCESS_ACTIVE = "active";

export async function registerSabrOriginRule() {
  const baseHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
    {
      header: "Origin",
      operation: "set",
      value: YOUTUBE_ORIGIN
    },
    {
      header: "Referer",
      operation: "set",
      value: YOUTUBE_REFERER
    }
  ];

  const secFetchHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
    {
      header: SEC_FETCH_SITE_HEADER,
      operation: "set",
      value: SEC_FETCH_SITE_CROSS_SITE
    },
    {
      header: SEC_FETCH_STORAGE_ACCESS_HEADER,
      operation: "set",
      value: SEC_FETCH_STORAGE_ACCESS_ACTIVE
    }
  ];

  const rule: Browser.declarativeNetRequest.Rule = {
    id: SABR_ORIGIN_RULE_ID,
    priority: SABR_RULE_PRIORITY,
    action: {
      type: "modifyHeaders",
      requestHeaders: [...baseHeaders, ...secFetchHeaders]
    },
    condition: {
      urlFilter: GOOGLEVIDEO_URL_FILTER
    }
  };
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SABR_ORIGIN_RULE_ID],
    addRules: [rule]
  });
}
