import type { PlayerResponse, PlaylistData } from "./types";

export async function getRemote(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

const gRegex = {
  videoData:
    /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/,
  playlistData: /ytInitialData\s*=\s*({.+?})\s*;/,
  playerData: /set\(({.+?})\);/
};

function getStringBetween(
  string: string,
  needleStart: string,
  needleEnd?: string,
  offsetStart = 0,
  offsetEnd = 0
): string {
  const x = string.indexOf(needleStart);
  const y = needleEnd ? string.indexOf(needleEnd, x) : string.length;
  return string.substring(x + needleStart.length + offsetEnd, y + offsetStart);
}

async function getAdaptiveFormats({
  videoData,
  playerData
}: {
  videoData: PlayerResponse;
  playerData: { PLAYER_JS_URL: string };
}) {
  const getUrlFromSignature = (signatureCipher: string): string => {
    const searchParams = new URLSearchParams(signatureCipher);
    const [url, signature, sp] = [
      searchParams.get("url"),
      searchParams.get("s"),
      searchParams.get("sp")
    ];

    return `${url}&${sp}=${decipher(signature)}`;
  };

  // eslint-disable-next-line @typescript-eslint/ban-types
  const getDecipherFunction = (string: string): Function => {
    const js = string.replace("var _yt_player={}", "");
    const top = getStringBetween(js, `a=a.split("")`, "};", 1, -28);
    const beginningOfFunction =
      "var " +
      getStringBetween(top, `a=a.split("")`, "(", 10, 1).split(".")[0] +
      "=";
    const side = getStringBetween(
      js,
      beginningOfFunction,
      "};",
      2,
      -beginningOfFunction.length
    );
    return eval(side + top);
  };

  const baseContent = await getRemote(
    `https://www.youtube.com${playerData.PLAYER_JS_URL}`
  );
  const decipher = getDecipherFunction(baseContent);

  const {
    streamingData: { adaptiveFormats }
  } = videoData;

  adaptiveFormats.forEach(format => {
    format.url = getUrlFromSignature(format.signatureCipher);
    delete format.signatureCipher;
  });

  return adaptiveFormats;
}

async function playlistToVideoIds(playlistId: string): Promise<string[]> {
  const htmlYouTubePage = await getRemote(
    `https://www.youtube.com/playlist?list=${playlistId}`
  );
  const playlistData = JSON.parse(
    htmlYouTubePage.match(gRegex.playlistData)[1]
  ) as PlaylistData;

  const videosContainer =
    playlistData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer
      .content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0]
      .playlistVideoListRenderer.contents;

  return videosContainer
    .filter(videoContainer => videoContainer.playlistVideoRenderer.isPlayable)
    .map(videoContainer => videoContainer.playlistVideoRenderer.videoId);
}

async function handleVideo(videoId: string): Promise<PlayerResponse> {
  const htmlYouTubePage = await getRemote(
    `https://www.youtube.com/watch?v=${videoId}`
  );
  const videoData = JSON.parse(
    htmlYouTubePage.match(gRegex.videoData)[1]
  ) as PlayerResponse;

  const isHasStreamingUrls = Boolean(
    videoData.streamingData?.adaptiveFormats[0].url
  );
  if (isHasStreamingUrls) {
    return videoData;
  }

  videoData.streamingData.adaptiveFormats = await getAdaptiveFormats({
    videoData,
    playerData: JSON.parse(htmlYouTubePage.match(gRegex.playerData)[1])
  });
  return videoData;
}

export async function getMediaMetadata({
  id,
  mediaType
}: {
  id: string;
  mediaType: "video" | "playlist";
}): Promise<PlayerResponse | string[]> {
  if (mediaType === "playlist") {
    return playlistToVideoIds(id);
  }

  return handleVideo(id);
}
