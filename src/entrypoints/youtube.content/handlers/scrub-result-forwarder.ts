import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { ScrubIframeMessageType, sendScrubIframeMessage } from "@/lib/messaging/scrub-iframe-messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";

export function registerScrubResultForwarder() {
  const params = new URLSearchParams(location.search);
  const helloVideoId = params.get("v") ?? "";
  const helloIndex = parseInt(params.get("ytdlScrubIndex") ?? "-1", 10);

  sendScrubIframeMessage(ScrubIframeMessageType.Hello, {
    videoId: helloVideoId,
    scrubIndex: helloIndex
  });
  sendScrubIframeMessage(ScrubIframeMessageType.Debug, {
    msg: `[ytdl:scrub-isolated] forwarder registered self===top=${self === top} url=${location.search.slice(0, 120)}`
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframeScrubDebug, ({ data }) => {
    sendScrubIframeMessage(ScrubIframeMessageType.Debug, { msg: data.msg });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframeScrubSegment, ({ data }) => {
    sendScrubIframeMessage(ScrubIframeMessageType.Debug, {
      msg: `[ytdl:scrub-isolated] received from MAIN index=${data.scrubIndex} videoBytes=${data.videoBytes.byteLength} audioBytes=${data.audioBytes.byteLength}`
    });
    sendScrubIframeMessage(ScrubIframeMessageType.Segment, {
      videoId: data.videoId,
      scrubIndex: data.scrubIndex,
      videoBase64: uint8ToBase64(data.videoBytes),
      audioBase64: uint8ToBase64(data.audioBytes),
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType,
      videoBufferStartSec: data.videoBufferStartSec,
      videoBufferEndSec: data.videoBufferEndSec
    });
    sendScrubIframeMessage(ScrubIframeMessageType.Debug, {
      msg: `[ytdl:scrub-isolated] forwarded to BG index=${data.scrubIndex}`
    });
  });
}
