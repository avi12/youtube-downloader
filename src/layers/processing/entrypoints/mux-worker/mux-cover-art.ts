import { required } from "@/lib/required";
import { buildInputArgs } from "./mux-ffmpeg-args";
import { state } from "./mux-state";
import { fetchThumbnail } from "./mux-thumbnail";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { CoverArtStyle, FFMPEG_CODEC_COPY, getCoverArtStyle } from "@/lib/utils/containers";
import type { Prettify } from "@/types";

const FFMPEG_CODEC_MJPEG = "mjpeg";
const JPEG_EXTENSION = "jpg";
const COVER_FILENAME_PREFIX = "cover";
const FLAC_PICTURE_TAG = "METADATA_BLOCK_PICTURE";
const FLAC_PICTURE_TYPE_FRONT_COVER = 3;
const FLAC_PICTURE_FIELD_BYTES = 4;
const FLAC_PICTURE_NUMBER_FIELDS = 8;
// Width, height, color depth and palette size, all left unspecified
const FLAC_PICTURE_DIMENSION_FIELDS = 4;

const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

type Thumbnail = NonNullable<Awaited<ReturnType<typeof fetchThumbnail>>>;

// Ogg holds no picture stream: players read the cover from a base64 FLAC picture block tag
function buildFlacPictureBlock({ data, extension }: Thumbnail) {
  const mimeType = new TextEncoder().encode(IMAGE_MIME_TYPES[extension]);
  const block = new Uint8Array(FLAC_PICTURE_NUMBER_FIELDS * FLAC_PICTURE_FIELD_BYTES + mimeType.length + data.length);
  const view = new DataView(block.buffer);
  let offset = 0;

  function writeNumber(value: number) {
    view.setUint32(offset, value);
    offset += FLAC_PICTURE_FIELD_BYTES;
  }

  function writeSized(bytes: Uint8Array) {
    writeNumber(bytes.length);
    block.set(bytes, offset);
    offset += bytes.length;
  }

  writeNumber(FLAC_PICTURE_TYPE_FRONT_COVER);
  writeSized(mimeType);
  const description = new Uint8Array();
  writeSized(description);
  offset += FLAC_PICTURE_DIMENSION_FIELDS * FLAC_PICTURE_FIELD_BYTES;
  writeSized(data);
  return block;
}

type PrepareCoverArtParams = Prettify<{
  thumbnailUrl: string | undefined;
  outputExtension: string;
}>;
export async function prepareCoverArt({ thumbnailUrl, outputExtension }: PrepareCoverArtParams) {
  const withoutCover = {
    filename: null,
    inputArgs: [],
    outputArgs: []
  };
  const style = getCoverArtStyle(outputExtension);
  const isCoverless = !thumbnailUrl || style === CoverArtStyle.Unsupported;
  if (isCoverless) {
    return withoutCover;
  }

  const thumbnail = await fetchThumbnail(thumbnailUrl);
  if (!thumbnail) {
    return withoutCover;
  }

  if (style === CoverArtStyle.VorbisComment) {
    const pictureBlock = uint8ToBase64(buildFlacPictureBlock(thumbnail));
    return {
      ...withoutCover,
      outputArgs: ["-metadata", `${FLAC_PICTURE_TAG}=${pictureBlock}`]
    };
  }

  const filename = `${COVER_FILENAME_PREFIX}.${thumbnail.extension}`;
  required(state.ffmpeg).FS.writeFile(filename, thumbnail.data);
  const codec = thumbnail.extension === JPEG_EXTENSION ? FFMPEG_CODEC_COPY : FFMPEG_CODEC_MJPEG;
  return {
    filename,
    inputArgs: buildInputArgs(filename),
    outputArgs: ["-map", "1", "-c:v", codec, "-disposition:v", "attached_pic"]
  };
}
