import { FactoryUrlParam } from "@/lib/youtube/youtube-url";

const SABR_ORIGIN_RULE_ID = 1;
const INNERTUBE_ORIGIN_RULE_ID = 2;
const CDN_ORIGIN_RULE_ID = 3;
const FACTORY_IFRAME_RULE_ID = 4;

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

  const chromeOnlyHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = [
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

  const sabrRule: Browser.declarativeNetRequest.Rule = {
    id: SABR_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [...baseHeaders, ...chromeOnlyHeaders]
    },
    condition: {
      urlFilter: "||googlevideo.com/videoplayback",
      requestMethods: ["post"]
    }
  };

  const cdnGetRule: Browser.declarativeNetRequest.Rule = {
    id: CDN_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Origin",
          operation: "remove"
        },
        {
          header: "Referer",
          operation: "remove"
        }
      ]
    },
    condition: {
      urlFilter: "||googlevideo.com/videoplayback",
      requestMethods: ["get"]
    }
  };

  const innertubeRule: Browser.declarativeNetRequest.Rule = {
    id: INNERTUBE_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: baseHeaders
    },
    condition: {
      regexFilter: "youtubei/v1/"
    }
  };

  const factoryIframeRule: Browser.declarativeNetRequest.Rule = {
    id: FACTORY_IFRAME_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        {
          header: "X-Frame-Options",
          operation: "remove"
        },
        {
          header: "Content-Security-Policy",
          operation: "remove"
        }
      ]
    },
    condition: {
      regexFilter: `${FactoryUrlParam.TrustFactoryMode}=1`,
      resourceTypes: ["sub_frame"]
    }
  };

  await Promise.all([
    browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SABR_ORIGIN_RULE_ID, INNERTUBE_ORIGIN_RULE_ID, CDN_ORIGIN_RULE_ID, FACTORY_IFRAME_RULE_ID]
    }),
    browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [SABR_ORIGIN_RULE_ID, INNERTUBE_ORIGIN_RULE_ID, CDN_ORIGIN_RULE_ID, FACTORY_IFRAME_RULE_ID],
      addRules: [sabrRule, cdnGetRule, innertubeRule, factoryIframeRule]
    })
  ]);
}
