const THUMBNAIL_WEBP_PATH = "/vi_webp/";
const THUMBNAIL_JPEG_PATH = "/vi/";

export function preferJpegThumbnail(url: string) {
  return url.replace(THUMBNAIL_WEBP_PATH, THUMBNAIL_JPEG_PATH).replace(/\.webp(\?|$)/, ".jpg$1");
}
