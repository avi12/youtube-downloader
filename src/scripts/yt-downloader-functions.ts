import type { AdaptiveFormatItem, VideoData } from "./types";
import { parseText } from "./utils";

async function getRemote(url: string, isGetText?: boolean): Promise<unknown> {
  const response = await fetch(url);
  const text = await response.text();
  console.log(text);
  if (isGetText) {
    return text;
  }
  return parseText(text);
}

export async function getVideoMetadata(id: string): Promise<VideoData> {
  const player = await getPlayerData(id);
  const data = await getVideoData({ id, sts: player.STS });
  console.log("data:", data);

  const { streamingData } = data.player_response;
  streamingData.adaptiveFormats = await getAdaptiveFormats({
    adaptiveFormats: streamingData.adaptiveFormats,
    id
  });

  return data;
}

// Credit for decipher functions: [ytdlr](https://github.com/bakapear/ytdlr/blob/master/ytdlr.js)
async function getAdaptiveFormats({
  adaptiveFormats,
  id
}: {
  adaptiveFormats: AdaptiveFormatItem[];
  id: string;
}) {
  const player = await getPlayerData(id);

  if (adaptiveFormats[0].signatureCipher) {
    const data = await getVideoData({ id, sts: player.STS });
    adaptiveFormats = data.player_response.streamingData.adaptiveFormats;
  }
  return decipherFormats(adaptiveFormats, player.funcDecipher);
}

function getStringBetween(
  string: string,
  needleStart,
  needleEnd?,
  offsetStart = 0,
  offsetEnd = 0
): string {
  if (needleStart instanceof RegExp) {
    needleStart = string.match(needleStart)[0];
  }
  const x = string.indexOf(needleStart);
  let y = string.indexOf(needleEnd, x);
  if (!needleEnd) {
    y = string.length;
  }
  return string.substring(x + needleStart.length + offsetEnd, y + offsetStart);
}

async function getPlayerData(
  id: string
  // eslint-disable-next-line @typescript-eslint/ban-types
): Promise<{ STS: number; funcDecipher: Function }> {
  const html = (await getRemote(
    `https://www.youtube.com/watch?v=${id}`,
    true
  )) as string;
  const ytcfg = JSON.parse(
    getStringBetween(
      html,
      /window\.ytplayer.*?=.*?{};.*?ytcfg\.set\(/s,
      "})",
      1
    )
  );
  const player = (await getRemote(
    `https://www.youtube.com${ytcfg.PLAYER_JS_URL}`,
    true
  )) as string;
  return {
    STS: ytcfg.STS,
    funcDecipher: getCipherFunction(player)
  };
}

// eslint-disable-next-line @typescript-eslint/ban-types
function getCipherFunction(string: string): Function {
  const js = getStringBetween(string, `a=a.split("");var `);
  const top = getStringBetween(js, 'a=a.split("")', "};", 1, -28);
  const fn =
    "var " +
    getStringBetween(top, 'a=a.split("")', "(", 10, 1).split(".")[0] +
    "=";
  const side = getStringBetween(js, fn, "};", 2, -fn.length);
  return eval(side + top);
}

async function getVideoData({
  id,
  sts
}: {
  id: string;
  sts: number;
}): Promise<VideoData> {
  const url = "https://www.youtube.com/get_video_info";
  const params = {
    video_id: id,
    eurl: `https://youtube.googleapis.com/v/${id}`,
    ps: "default",
    gl: "US",
    hl: "en",
    el: "embedded",
    sts,
    c: "TVHTML5",
    html5: 1,
    cver: "6.20180913"
  };

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const searchParams = new URLSearchParams(Object.entries(params));
  return (await getRemote(`${url}?${searchParams}`)) as VideoData;
}

function decipherFormats(
  adaptiveFormats: AdaptiveFormatItem[],
  // eslint-disable-next-line @typescript-eslint/ban-types
  funcDecipher: Function
): AdaptiveFormatItem[] {
  return adaptiveFormats.map(item => {
    if (item.mimeType) {
      item.mimeType = item.mimeType.replace(/\+/g, " ");
    }

    if (item.signatureCipher) {
      const { url, sp, s } = Object.fromEntries(
        new URLSearchParams(item.signatureCipher)
      );
      delete item.signatureCipher;
      const url1 = decodeURIComponent(url);
      const cipher = funcDecipher(decodeURIComponent(s));
      item.url = `${url1}&${sp}=${cipher}`;
    }

    return item;
  });
}
