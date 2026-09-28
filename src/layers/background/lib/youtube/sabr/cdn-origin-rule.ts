import { YOUTUBE_ORIGIN } from "./request-capture";

const CDN_ORIGIN_RULE_ID = 1;
const GOOGLEVIDEO_URL_FILTER = "*.googlevideo.com/videoplayback*";

export async function registerCdnOriginRule() {
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CDN_ORIGIN_RULE_ID],
    addRules: [
      {
        id: CDN_ORIGIN_RULE_ID,
        action: {
          type: browser.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: "Origin",
              operation: browser.declarativeNetRequest.HeaderOperation.SET,
              value: YOUTUBE_ORIGIN
            },
            {
              header: "Referer",
              operation: browser.declarativeNetRequest.HeaderOperation.SET,
              value: `${YOUTUBE_ORIGIN}/`
            },
            {
              header: "Sec-Fetch-Site",
              operation: browser.declarativeNetRequest.HeaderOperation.SET,
              value: "cross-site"
            },
            {
              header: "Sec-Fetch-Storage-Access",
              operation: browser.declarativeNetRequest.HeaderOperation.SET,
              value: "active"
            }
          ]
        },
        condition: {
          urlFilter: GOOGLEVIDEO_URL_FILTER,
          // Only the extension's own fetches (service worker, offscreen document and
          // the player iframe it hosts) lack a tab. Rewriting Origin on a real tab
          // breaks playback on every YouTube host except www - the CDN then echoes an
          // Access-Control-Allow-Origin the page cannot accept
          tabIds: [browser.tabs.TAB_ID_NONE]
        }
      }
    ]
  });
}
