import { resolveVideoFilename } from "@/lib/utils/containers";
import { resolveDownloadType } from "@/lib/youtube/download-type";
import { selectVideoFormatForOptions } from "@/lib/youtube/select-video-quality";
import { VideoQualityMode, type Options, type Prettify, type VideoData } from "@/types";

type PlaylistMetadata = Prettify<{
  playlistId: string;
  playlistTitle: string;
  playlistOwner: string;
}> | null;

export function optionsToQualityValue(options: Options) {
  return options.videoQualityMode === VideoQualityMode.Custom
    ? String(options.videoQuality)
    : VideoQualityMode.Best;
}

export function buildDownloadRequest({
  data,
  options,
  playlistId,
  playlistTitle,
  playlistTotalCount,
  isZipBundle
}: {
  data: VideoData;
  options: Options;
  playlistId: string;
  playlistTitle: string;
  playlistTotalCount: number;
  isZipBundle: boolean;
}) {
  const downloadType = resolveDownloadType({
    preference: options.defaultDownloadType,
    isMusic: data.isMusic
  });

  const videoFormat = selectVideoFormatForOptions({
    videoData: data,
    options
  });

  return {
    type: downloadType,
    videoId: data.videoId,
    videoItag: videoFormat?.itag ?? 0,
    audioItag: data.audioFormats[0]?.itag ?? 0,
    filenameOutput: resolveVideoFilename({
      videoData: data,
      options
    }),
    ...(isZipBundle && {
      playlistId,
      playlistTitle,
      playlistTotalCount
    })
  };
}

export function resolveDefaultZipName(metadata: PlaylistMetadata) {
  if (metadata?.playlistTitle) {
    return metadata.playlistTitle;
  }

  if (metadata?.playlistOwner) {
    return `${metadata.playlistOwner}'s playlist`;
  }

  return "Playlist";
}
