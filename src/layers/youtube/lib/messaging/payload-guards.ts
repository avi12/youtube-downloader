// Guards for payloads that cross worlds, where page scripts can forge anything
import { z } from "@/lib/zod";
import { createGuard, tolerated } from "@/lib/zod-guard";
import { DownloadType, ProgressType } from "@/types";
import { codecPreferencesSchema, videoMetadataSchema } from "@/types/settings-types";

const anyNumberSchema = z.union([z.number(), z.nan()]);

const videoIdPayloadSchema = z.looseObject({ videoId: z.string() });

export const isVideoIdPayload = createGuard(videoIdPayloadSchema);

export const isVideoIdsPayload = createGuard(z.looseObject({ videoIds: z.array(z.string()) }));

export const isContentIdPayload = createGuard(z.looseObject({ contentId: z.string() }));

export const isNavigationPayload = createGuard(z.looseObject({ url: z.string() }));

export const isPanelContentPayload = createGuard(
  z.looseObject({
    contentId: z.string(),
    videoDataJson: z.string()
  })
);

export const isRequestJsonPayload = createGuard(z.looseObject({ requestJson: z.string() }));

export const isStreamErrorPayload = createGuard(
  videoIdPayloadSchema.extend({ error: z.string() })
);

// Stripping objects, since a loose one would walk every index of the byte arrays
const bytesSchema = z.lazy(() => z.instanceof(Uint8Array)).nullable();

export const isStreamDataPayload = createGuard(
  z.object({
    downloadType: z.enum(DownloadType),
    videoId: z.string(),
    filenameOutput: z.string(),
    videoData: bytesSchema,
    audioData: bytesSchema,
    videoMimeType: z.string(),
    audioMimeType: z.string(),
    audioLabel: z.string(),
    additionalAudioData: z.array(
      z.object({
        data: bytesSchema,
        mimeType: z.string(),
        label: z.string()
      })
    ),
    metadata: videoMetadataSchema.nullish()
  })
);

export const isDownloadAnnouncement = createGuard(
  videoIdPayloadSchema.extend({
    type: z.enum(DownloadType),
    filenameOutput: z.string(),
    title: tolerated(z.string()),
    channel: tolerated(z.string()),
    thumbnailUrl: tolerated(z.string()),
    lengthSeconds: tolerated(z.number())
  })
);

export const isDownloadBlobUrlPayload = createGuard(
  videoIdPayloadSchema.extend({
    blobUrl: z.string(),
    filename: z.string()
  })
);

export const isPageProgressPayload = createGuard(
  videoIdPayloadSchema.extend({
    progress: anyNumberSchema,
    progressType: z.enum(ProgressType)
  })
);

export const isDownloadFailedPayload = createGuard(
  videoIdPayloadSchema.extend({ isUnavailable: z.boolean().optional() })
);

const fetchHeadersSchema = z.record(z.string(), z.string());

export const isProxyFetchRequest = createGuard(
  z.looseObject({
    url: z.string(),
    method: z.string(),
    bodyBase64: z.string(),
    headers: fetchHeadersSchema
  })
);

export const isPageSabrFetchRequest = createGuard(
  z.looseObject({
    url: z.string(),
    method: z.string(),
    bodyBase64: z.string(),
    headers: fetchHeadersSchema.optional()
  })
);

export const isPageSabrFetchResponse = createGuard(
  z.looseObject({
    status: z.number(),
    bodyBase64: z.string(),
    responseHeaders: fetchHeadersSchema
  }).nullable()
);

export const isCreateDropdownPayload = createGuard(
  z.looseObject({
    contentId: z.string(),
    positionTargetSelector: z.string()
  })
);

export const isSetButtonDataPayload = createGuard(
  z.looseObject({
    selector: z.string(),
    data: z.looseObject({}),
    a11y: z.looseObject({
      tabIndex: z.number(),
      role: z.string(),
      ariaChecked: z.string()
    }).optional()
  })
);

export const isSettingsOptionsPayload = createGuard(
  z.looseObject({
    selector: z.string(),
    title: z.string()
  })
);

export const isFilenameChangedPayload = createGuard(
  z.looseObject({
    filename: z.string(),
    quality: z.string().optional(),
    videoItag: z.number().optional(),
    audioItag: z.number().optional(),
    audioTrackId: z.string().optional(),
    codecPreferences: codecPreferencesSchema.optional(),
    downloadType: z.enum(DownloadType).optional()
  })
);

export const isSizeInputsRequest = createGuard(
  videoIdPayloadSchema.extend({
    params: z.looseObject({
      type: z.enum(DownloadType),
      videoItag: z.number(),
      audioItag: z.number(),
      audioTrackId: z.string().optional(),
      codecPreferences: codecPreferencesSchema.optional(),
      selectedCaptionVssId: z.string().optional(),
      downloadExtras: z.boolean().optional(),
      downloadExtraCaptions: z.boolean().optional(),
      includeAutoDubbing: z.boolean().optional()
    })
  })
);

export const isSizeInputs = createGuard(
  z.looseObject({
    captionVtts: z.array(z.string().nullable()),
    coverBytes: z.number(),
    tags: z.array(z.string())
  })
);

export const isOptions = createGuard(
  z.looseObject({
    ext: z.looseObject({
      audio: z.string(),
      video: z.string()
    }),
    isShowNativeDownload: z.boolean()
  })
);
