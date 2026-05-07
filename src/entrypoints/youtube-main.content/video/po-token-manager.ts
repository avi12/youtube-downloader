import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { generatePoToken } from "@/lib/youtube/po-token-generator";
import type { VideoData } from "@/types";

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  if (capturedPoToken && capturedPoTokenVideoId === videoData.videoId) {
    return;
  }

  try {
    const [poToken, alternateClientPoToken] = await Promise.all([
      generatePoToken({ videoId: videoData.videoId }),
      Promise.resolve("")
    ]);
    const { serverAbrStreamingUrl: sabrUrl = "" } = videoData.sabrConfig ?? {};
    setPoTokenCredentials({
      poToken,
      alternateClientPoToken,
      sabrUrl,
      videoId: videoData.videoId
    });
    sabrCredentials.value = {
      url: sabrCredentials.value?.url || sabrUrl,
      poToken
    };
  } catch (error) {
    console.warn("[ytdl] PO token generation failed:", error);
  }
}
