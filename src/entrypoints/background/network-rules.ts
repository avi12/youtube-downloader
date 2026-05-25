const SABR_ORIGIN_RULE_ID = 1;
export async function registerSabrOriginRule() {
  const baseHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
    {
      header: "Origin",
      operation: "set",
      value: "https://www.youtube.com"
    },
    {
      header: "Referer",
      operation: "set",
      value: "https://www.youtube.com/"
    }
  ];

  const secFetchHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
    {
      header: "Sec-Fetch-Site",
      operation: "set",
      value: "cross-site"
    },
    {
      header: "Sec-Fetch-Storage-Access",
      operation: "set",
      value: "active"
    }
  ];

  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SABR_ORIGIN_RULE_ID],
    addRules: [{
      id: SABR_ORIGIN_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [...baseHeaders, ...secFetchHeaders]
      },
      condition: {
        urlFilter: "||googlevideo.com/videoplayback"
      }
    }]
  });
}
