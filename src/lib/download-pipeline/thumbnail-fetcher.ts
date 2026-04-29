const JPEG_MAGIC_BYTES = [0xFF, 0xD8, 0xFF];
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4E, 0x47];
const RIFF_MAGIC_BYTES = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC_BYTES = [0x57, 0x45, 0x42, 0x50];
const WEBP_MAGIC_OFFSET = 8;

function matchesMagicBytes({ data, bytes, offset = 0 }: {
  data: Uint8Array;
  bytes: number[];
  offset?: number;
}) {
  return bytes.every((byte, i) => data[offset + i] === byte);
}

function detectImageExtension(data: Uint8Array) {
  if (matchesMagicBytes({
    data,
    bytes: JPEG_MAGIC_BYTES
  })) {
    return "jpg";
  }

  if (matchesMagicBytes({
    data,
    bytes: PNG_MAGIC_BYTES
  })) {
    return "png";
  }

  if (matchesMagicBytes({
    data,
    bytes: RIFF_MAGIC_BYTES
  }) && matchesMagicBytes({
    data,
    bytes: WEBP_MAGIC_BYTES,
    offset: WEBP_MAGIC_OFFSET
  })) {
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
