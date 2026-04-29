export interface ClientSpec {
  clientName: string;
  clientVersion: string;
  clientNameHeader: string;
  context: Record<string, unknown>;
}

const TV_EMBED_CLIENT: ClientSpec = {
  clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
  clientNameHeader: "85",
  clientVersion: "2.0",
  context: {
    osName: "Tizen",
    osVersion: "1.0",
    userAgent: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/5.0 Safari/605.1.15"
  }
};

const IOS_CLIENT: ClientSpec = {
  clientName: "IOS",
  clientNameHeader: "5",
  clientVersion: "20.10.4",
  context: {
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.1.0.22B83",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)"
  }
};

const MWEB_CLIENT: ClientSpec = {
  clientName: "MWEB",
  clientNameHeader: "2",
  clientVersion: "2.20240101.00.00",
  context: {
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iOS",
    osVersion: "18.1.0",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.85 Mobile/15E148 Safari/605.1.15"
  }
};

export const CLIENT_CHAIN: ClientSpec[] = [
  TV_EMBED_CLIENT,
  IOS_CLIENT,
  MWEB_CLIENT
];

export async function buildSapiSidHash(): Promise<string | null> {
  const cookie = await browser.cookies.get({
    url: "https://www.youtube.com",
    name: "__Secure-3PAPISID"
  }).catch(() => null);
  if (!cookie?.value) {
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp} ${cookie.value} https://www.youtube.com`;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(message));
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${timestamp}_${hash}`;
}
