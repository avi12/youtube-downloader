const THUMBNAIL_WEBP_PATH = "/vi_webp/";
const THUMBNAIL_JPEG_PATH = "/vi/";

export function preferJpegThumbnail(url: string) {
  return url.replace(THUMBNAIL_WEBP_PATH, THUMBNAIL_JPEG_PATH).replace(/\.webp(\?|$)/, ".jpg$1");
}

const VIDEO_THUMBNAIL_HOST = "https://i.ytimg.com/vi";

type ResolveDisplayThumbnailUrlParams = {
  videoId?: string;
  thumbnailUrl?: string;
};
// thumbnailUrl may be square YouTube Music cover art meant for ID3 embedding,
// so the standard video thumbnail wins whenever the video ID is known
export function resolveDisplayThumbnailUrl({ videoId, thumbnailUrl }: ResolveDisplayThumbnailUrlParams) {
  return videoId ? `${VIDEO_THUMBNAIL_HOST}/${videoId}/mqdefault.jpg` : thumbnailUrl;
}
