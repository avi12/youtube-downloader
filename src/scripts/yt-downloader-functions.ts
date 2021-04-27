import type { AdaptiveFormatItem, PlayerResponse, VideoData } from "./types";
import { getRemote } from "./background";

export async function getVideoMetadata({
  id,
  titleCurrent,
  adaptiveFormats,
  ytcfg
}: {
  id: string;
  titleCurrent?: string;
  adaptiveFormats?: AdaptiveFormatItem[];
  ytcfg?: {
    STS: number;
    PLAYER_JS_URL: string;
  };
}): Promise<{ formats: AdaptiveFormatItem[]; title: string }> {
  const isVideoPage = Boolean(ytcfg);
  const isDownloadable = Boolean(adaptiveFormats[0]?.url);

  // These if statements are to save on resources,
  // make faster download(s), as less network requests are made
  if (isVideoPage) {
    if (isDownloadable) {
      return {
        title: titleCurrent,
        formats: adaptiveFormats
      };
    }

    return {
      title: titleCurrent,
      formats: await getAdaptiveFormats({ ytcfg, adaptiveFormats, id })
    };
  }

  const player = await getPlayerData({ id, ytcfg });
  const data = await getVideoData({ id, sts: player.STS });
  const formats = adaptiveFormats[0].signatureCipher
    ? decipherFormats(data.streamingData.adaptiveFormats, player.funcDecipher)
    : adaptiveFormats;

  const title =
    titleCurrent || getText(data.microformat.playerMicroformatRenderer.title);

  return {
    title: title.replace(/\+/g, " "),
    formats
  };
}

// Credit for decipher functions: https://github.com/bakapear/ytdlr/blob/master/ytdlr.js
async function getAdaptiveFormats({
  adaptiveFormats,
  ytcfg,
  id
}: {
  ytcfg?: { STS: number; PLAYER_JS_URL: string };
  adaptiveFormats: AdaptiveFormatItem[];
  id: string;
}) {
  const player = await getPlayerData({ id, ytcfg });

  if (adaptiveFormats[0].signatureCipher) {
    const data = await getVideoData({ id, sts: player.STS });
    adaptiveFormats = data.streamingData.adaptiveFormats;
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

async function getPlayerData({
  id,
  ytcfg
}: {
  id: string;
  ytcfg?: { STS: number; PLAYER_JS_URL: string };
}) {
  if (!ytcfg) {
    const html = await getRemote(`https://www.youtube.com/watch?v=${id}`, true);
    ytcfg = JSON.parse(
      getStringBetween(
        html,
        /window\.ytplayer.*?=.*?{};.*?ytcfg\.set\(/s,
        "})",
        1
      )
    );
  }
  const player = await getRemote(
    `https://www.youtube.com${ytcfg.PLAYER_JS_URL}`,
    true
  );
  return {
    STS: ytcfg.STS,
    funcDecipher: getCipherFunction(player)
  };
}

function getCipherFunction(string: string) {
  const keys = ['a=a.split("")', "};", "var ", "(", "="];
  const js = getStringBetween(string, `${keys[0]};${keys[2]}`);
  const top = getStringBetween(js, keys[0], keys[1], 1, -28);
  const fn =
    keys[2] +
    getStringBetween(top, keys[0], keys[3], 10, 1).split(".")[0] +
    keys[4];
  const side = getStringBetween(js, fn, keys[1], 2, -fn.length);
  return eval(side + top);
}

async function getVideoData({
  id,
  sts
}: {
  id: string;
  sts: number;
}): Promise<PlayerResponse> {
  const url = new URL("https://www.youtube.com/get_video_info");
  const params = {
    video_id: id,
    eurl: `https://youtube.googleapis.com/v/${id}`,
    ps: "default",
    gl: "US",
    hl: "en",
    el: "embedded",
    sts
  };

  // @ts-ignore
  const searchParams = new URLSearchParams(Object.entries(params));
  const { player_response } = (await getRemote(
    `${url}?${searchParams}`
  )) as VideoData;
  return player_response;
}

function decipherFormats(
  adaptiveFormats: AdaptiveFormatItem[],
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

function getText(param): string {
  return (param?.simpleText ?? param).replace(/\+/g, " ");
}
