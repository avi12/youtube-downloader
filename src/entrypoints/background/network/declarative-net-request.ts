import { ScrubUrlParam } from "@/lib/youtube/youtube-url";

const SABR_ORIGIN_RULE_ID = 1;
const INNERTUBE_ORIGIN_RULE_ID = 2;
const CDN_ORIGIN_RULE_ID = 3;

const CHROME_USER_AGENT_SPOOF =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

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

  const firefoxOnlyHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = import.meta.env.FIREFOX
    ? [
      {
        header: "User-Agent",
        operation: "set",
        value: CHROME_USER_AGENT_SPOOF
      }
    ]
    : [];

  const chromeOnlyHeaders: Browser.declarativeNetRequest.ModifyHeaderInfo[] = import.meta.env.FIREFOX
    ? []
    : [
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
      requestHeaders: [...baseHeaders, ...chromeOnlyHeaders, ...firefoxOnlyHeaders]
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

  await Promise.all([
    browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SABR_ORIGIN_RULE_ID, INNERTUBE_ORIGIN_RULE_ID, CDN_ORIGIN_RULE_ID]
    }),
    browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [SABR_ORIGIN_RULE_ID, INNERTUBE_ORIGIN_RULE_ID, CDN_ORIGIN_RULE_ID],
      addRules: [sabrRule, cdnGetRule, innertubeRule]
    })
  ]);
}

export function registerFactoryIframeHeaderStripper() {
  if (!import.meta.env.FIREFOX) {
    return;
  }

  browser.webRequest.onHeadersReceived.addListener(
    ({ url, responseHeaders }) => {
      const isHostedIframe = url.includes(`${ScrubUrlParam.TrustFactoryMode}=1`) || url.includes(`${ScrubUrlParam.ScrubMode}=1`);
      if (!isHostedIframe || !responseHeaders) {
        return {};
      }

      const filtered = responseHeaders.filter(({ name }) => {
        const lower = name.toLowerCase();
        return lower !== "x-frame-options" && lower !== "content-security-policy";
      });
      return { responseHeaders: filtered };
    },
    {
      urls: [
        `https://www.youtube.com/*${ScrubUrlParam.TrustFactoryMode}=1*`,
        `https://www.youtube.com/*${ScrubUrlParam.ScrubMode}=1*`
      ],
      types: ["sub_frame"]
    },
    ["blocking", "responseHeaders"]
  );
}
