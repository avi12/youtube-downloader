const DOWNLOAD_FRAME_PARAM = "ytdl";
const DOWNLOAD_FRAME_VALUE = "1";

export const DOWNLOAD_FRAME_QUERY = { [DOWNLOAD_FRAME_PARAM]: DOWNLOAD_FRAME_VALUE };

export function isDownloadFrame() {
  const isNestedFrame = self !== top;
  return isNestedFrame && new URLSearchParams(location.search).get(DOWNLOAD_FRAME_PARAM) === DOWNLOAD_FRAME_VALUE;
}
