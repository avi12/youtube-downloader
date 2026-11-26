import { getCompatibleFilename } from "@/lib/utils/filename";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

const log = createLogger(LogScope.Background);

export async function tryDirectUrlDownload({ request }: {
  request: DownloadRequest;
}) {
  const { type, resolvedAudioUrl, filenameOutput } = request;
  const isAudioOnly = type === DownloadType.Audio;
  const canDirectDownload = isAudioOnly && !!resolvedAudioUrl;
  if (!canDirectDownload) {
    return null;
  }

  try {
    const filename = getCompatibleFilename(filenameOutput);
    const downloadId = await browser.downloads.download({
      url: resolvedAudioUrl,
      filename
    });
    log.warn("Direct URL download started, id:", downloadId);
    return downloadId;
  } catch (error) {
    log.warn("Direct URL download failed:", error);
    return null;
  }
}
