const JPEG_MAGIC_BYTES = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4E, 0x47];
const RIFF_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC_BYTES = [0x57, 0x45, 0x42, 0x50];
const WEBP_MAGIC_OFFSET = 8;

function matchesMagicBytes(data: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes(data, JPEG_MAGIC_BYTES)) {
    return "jpg";
  }

  if (matchesMagicBytes(data, PNG_MAGIC_BYTES)) {
    return "png";
  }

  if (matchesMagicBytes(data, RIFF_MAGIC_BYTES) && matchesMagicBytes(data, WEBP_MAGIC_BYTES, WEBP_MAGIC_OFFSET)) {
    return "webp";
  }

  return "jpg";
}

function preferJpegThumbnail(url: string) {
  return url.replace("/vi_webp/", "/vi/").replace(/\.webp(\?|$)/, ".jpg$1");
}

export async function fetchThumbnail(url: string) {
  try {
    const response = await fetch(preferJpegThumbnail(url));
    if (!response.ok) {
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return {
      data,
      extension: detectImageExtension(data)
    };
  } catch {
    return null;
  }
}

export function sanitizeForFFmpeg(value: string) {
  return value.replaceAll(/[\n\r"\\]/g, " ").trim();
}
