import { alignFormatsToContainer, resolveVideoFormatVariants } from "./align-formats-to-container";
import { orderCaptionsByPreference, resolveCaptionLanguageMode } from "./caption-helpers";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { isAudioCodecPreferredForContainer } from "@/lib/utils/containers";
import {
  type AdaptiveFormatItem,
  type CaptionTrack,
  type CodecPreferences,
  type DownloadRequest,
  DownloadType,
  type Prettify,
  type TranslationLanguage
} from "@/types";

export const AUTO_DUB_TRACK_SUFFIX = ".10";
const TRANSLATED_CAPTION_VSSID_PREFIX = "t.";
const MAX_ADDITIONAL_AUDIO_TRACKS = 16;

type BuildTranslatedCaptionTrackParams = Prettify<{
  sourceTrack: CaptionTrack;
  languageCode: string;
  languageName: TranslationLanguage["languageName"];
}>;
export function buildTranslatedCaptionTrack({
  sourceTrack, languageCode, languageName
}: BuildTranslatedCaptionTrackParams) {
  return {
    baseUrl: sourceTrack.baseUrl,
    name: languageName,
    vssId: `${TRANSLATED_CAPTION_VSSID_PREFIX}${languageCode}`,
    languageCode,
    isTranslatable: false,
    translationLanguageCode: languageCode,
    sourceTrackVssId: sourceTrack.vssId
  };
}

function buildSelectedTranslatedTrack(
  vssId: string,
  captionTracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[]
) {
  const isTranslatedCaption = vssId.startsWith(TRANSLATED_CAPTION_VSSID_PREFIX);
  if (!isTranslatedCaption) {
    return null;
  }

  const languageCode = vssId.slice(TRANSLATED_CAPTION_VSSID_PREFIX.length);
  const translationLanguage = translationLanguages.find(language => language.languageCode === languageCode);
  const sourceTrack = captionTracks.find(track => track.isTranslatable);
  const isMissingTranslationData = !translationLanguage || !sourceTrack;
  if (isMissingTranslationData) {
    return null;
  }

  return buildTranslatedCaptionTrack({
    sourceTrack,
    languageCode,
    languageName: translationLanguage.languageName
  });
}

type ResolveOrderedCaptionTracksParams = Prettify<{
  captionTracks: CaptionTrack[];
  selectedCaptionVssId: string | undefined;
  downloadExtras: boolean;
}>;
function resolveOrderedCaptionTracks({
  captionTracks, selectedCaptionVssId, downloadExtras
}: ResolveOrderedCaptionTracksParams) {
  const options = CONTENT_OPTIONS;
  const captionMode = resolveCaptionLanguageMode({
    captionMode: options.captionLanguageMode,
    audioMode: options.audioTrackLanguageMode
  });
  const allCaptionTracks = orderCaptionsByPreference({
    captionTracks,
    languageMode: captionMode,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language,
    customLanguage: options.customLanguage
  });
  const primaryCaptionTrack = selectedCaptionVssId
    ? (allCaptionTracks.find(track => track.vssId === selectedCaptionVssId) ?? allCaptionTracks[0])
    : allCaptionTracks[0];
  if (!downloadExtras) {
    return primaryCaptionTrack ? [primaryCaptionTrack] : [];
  }

  const nativeTracks = allCaptionTracks.filter(track => !track.translationLanguageCode);
  const isSelectedTranslated = !!primaryCaptionTrack?.translationLanguageCode;
  return isSelectedTranslated ? [primaryCaptionTrack, ...nativeTracks] : nativeTracks;
}

type GetExtraAudioFormatsParams = Prettify<{
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
  selectedFormat: AdaptiveFormatItem | null;
  includeAutoDubbing: boolean;
}>;
function getExtraAudioFormats({
  audioFormats, selectedTrackId, selectedFormat, includeAutoDubbing
}: GetExtraAudioFormatsParams) {
  const isSelectedAutoDub = !includeAutoDubbing && selectedTrackId?.endsWith(AUTO_DUB_TRACK_SUFFIX);
  if (isSelectedAutoDub) {
    return [];
  }

  const seenTrackIds = new Set(selectedTrackId ? [selectedTrackId] : []);
  let isUntaggedExtraPresent = !selectedTrackId;
  const result: AdaptiveFormatItem[] = [];
  for (const format of audioFormats) {
    const isAtTrackLimit = result.length >= MAX_ADDITIONAL_AUDIO_TRACKS;
    if (isAtTrackLimit) {
      break;
    }

    const isSelectedFormat = format === selectedFormat;
    if (isSelectedFormat) {
      continue;
    }

    const trackId = format.audioTrack?.id;
    if (!trackId) {
      if (isUntaggedExtraPresent) {
        continue;
      }

      isUntaggedExtraPresent = true;
      result.push(format);
      continue;
    }

    const isAutoDubTrack = !includeAutoDubbing && trackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    if (isAutoDubTrack) {
      continue;
    }

    const isTrackAlreadySeen = seenTrackIds.has(trackId);
    if (isTrackAlreadySeen) {
      continue;
    }

    seenTrackIds.add(trackId);
    result.push(format);
  }

  return result;
}

type SelectFormatsParams = Prettify<{
  videoFormats: AdaptiveFormatItem[];
  videoFormatVariants: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
  audioTrackId: string | undefined;
}>;
function selectFormats({
  videoFormats, videoFormatVariants, audioFormats, type, videoItag, audioItag, audioTrackId
}: SelectFormatsParams) {
  const isVideoRequested = type !== DownloadType.Audio;
  const videoFormat = isVideoRequested
    ? (videoFormatVariants.find(format => format.itag === videoItag) ?? videoFormats[0]!)
    : null;

  const isAudioRequested = type !== DownloadType.Video;
  if (!isAudioRequested) {
    return {
      videoFormat,
      audioFormat: null
    };
  }

  const byItag = audioFormats.filter(format => format.itag === audioItag);
  const audioFormat = (audioTrackId ? byItag.find(format => format.audioTrack?.id === audioTrackId) : null)
    ?? byItag[0]
    ?? audioFormats[0]
    ?? null;
  return {
    videoFormat,
    audioFormat
  };
}

type DownloadPlanVideoData = Prettify<{
  videoFormats: AdaptiveFormatItem[];
  videoFormatVariants?: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
  translationLanguages: TranslationLanguage[];
}>;

export type DownloadPlanParams = Prettify<Pick<DownloadRequest,
  "type" | "videoItag" | "audioItag" | "audioTrackId" | "selectedCaptionVssId" |
  "downloadExtras" | "downloadExtraCaptions" | "includeAutoDubbing"
>>;

function sortPreferredAudioFirst({ audioFormats, targetExtension, codecPreferences }: {
  audioFormats: AdaptiveFormatItem[];
  targetExtension: string;
  codecPreferences: CodecPreferences;
}) {
  const preferredFormats = audioFormats.filter(format => isAudioCodecPreferredForContainer({
    audioMimeType: format.mimeType,
    targetExtension,
    codecPreferences
  }));
  return [...preferredFormats, ...audioFormats.filter(format => !preferredFormats.includes(format))];
}

type AlignPlanFormatsParams = Prettify<{
  videoData: DownloadPlanVideoData;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  targetExtension: string | undefined;
  codecPreferences: CodecPreferences;
}>;
function alignPlanFormats({
  videoData, videoFormat, audioFormat, targetExtension, codecPreferences
}: AlignPlanFormatsParams) {
  const isAudioOnlyOrUnknownContainer = !videoFormat || !targetExtension;
  if (isAudioOnlyOrUnknownContainer) {
    return {
      videoFormat,
      audioFormat,
      audioFormats: videoData.audioFormats
    };
  }

  return {
    ...alignFormatsToContainer({
      videoData,
      videoFormat,
      audioFormat,
      targetExtension,
      codecPreferences
    }),
    audioFormats: sortPreferredAudioFirst({
      audioFormats: videoData.audioFormats,
      targetExtension,
      codecPreferences
    })
  };
}

type ResolveDownloadPlanParams = Prettify<{
  videoData: DownloadPlanVideoData;
  params: DownloadPlanParams;
  targetExtension?: string;
}>;
export function resolveDownloadPlan({ videoData, params, targetExtension }: ResolveDownloadPlanParams) {
  const downloadExtras = params.downloadExtras ?? true;
  const downloadExtraCaptions = params.downloadExtraCaptions ?? true;
  const includeAutoDubbing = params.includeAutoDubbing ?? true;
  const translatedTrack = params.selectedCaptionVssId
    ? buildSelectedTranslatedTrack(params.selectedCaptionVssId, videoData.captionTracks, videoData.translationLanguages)
    : null;
  const captionTracks = resolveOrderedCaptionTracks({
    captionTracks: translatedTrack ? [...videoData.captionTracks, translatedTrack] : videoData.captionTracks,
    selectedCaptionVssId: params.selectedCaptionVssId,
    downloadExtras: downloadExtraCaptions
  });
  const selected = selectFormats({
    videoFormats: videoData.videoFormats,
    videoFormatVariants: resolveVideoFormatVariants(videoData),
    audioFormats: videoData.audioFormats,
    type: params.type,
    videoItag: params.videoItag,
    audioItag: params.audioItag,
    audioTrackId: params.audioTrackId
  });
  const { videoFormat, audioFormat, audioFormats } = alignPlanFormats({
    videoData,
    ...selected,
    targetExtension,
    codecPreferences: CONTENT_OPTIONS
  });
  const extraAudioFormats = downloadExtras && audioFormat
    ? getExtraAudioFormats({
      audioFormats,
      selectedTrackId: audioFormat.audioTrack?.id,
      selectedFormat: audioFormat,
      includeAutoDubbing
    })
    : [];
  return {
    videoFormat,
    audioFormat,
    extraAudioFormats,
    captionTracks
  };
}
