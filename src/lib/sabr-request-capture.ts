/**
 * Captures YouTube player's SABR request bodies via chrome.webRequest.
 *
 * YouTube's SABR requests contain a PO (Proof of Origin) token that we
 * cannot generate ourselves. By capturing the player's own request body
 * (which includes the PO token), we can replay it for our downloads.
 *
 * Runs in the background service worker.
 */

type CapturedSabrData = {
  body: number[];
  url: string;
  tabId: number;
  timestamp: number;
};

const capturedByTab = new Map<number, CapturedSabrData>();

/**
 * Starts listening for SABR requests from YouTube pages.
 * Should be called once from the background service worker.
 */
export function startSabrRequestCapture() {
  browser.webRequest.onBeforeRequest.addListener(
    handleSabrRequest,
    {
      urls: ["https://*.googlevideo.com/videoplayback*"],
      types: ["xmlhttprequest", "other"]
    },
    ["requestBody"]
  );
}

let onCaptureCallback: ((tabId: number) => void) | null = null;

/** Registers a callback invoked the first time a SABR body is captured per tab. */
export function onSabrBodyCaptured(callback: (tabId: number) => void) {
  onCaptureCallback = callback;
}

function handleSabrRequest(
  details: Browser.webRequest.OnBeforeRequestDetails
): undefined {
  if (details.tabId < 0) {
    return undefined;
  }

  if (!details.requestBody?.raw?.[0]?.bytes) {
    return undefined;
  }

  const bodyBytes = new Uint8Array(details.requestBody.raw[0].bytes);
  const isFirstCapture = !capturedByTab.has(details.tabId);
  // Always save the latest SABR request body. The PO token evolves during
  // the session, so the latest body has the most valid token.
  capturedByTab.set(details.tabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: details.tabId,
    timestamp: Date.now()
  });

  if (isFirstCapture) {
    onCaptureCallback?.(details.tabId);
  }
}

/**
 * Returns the captured SABR request data for a given tab.
 * The body contains the PO token and full ABR state from YouTube's player.
 */
export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? null;
}

/**
 * Extracts just the PO token (base64) from a captured SABR request body.
 * The PO token is at: VideoPlaybackAbrRequest.streamerContext.poToken
 * In protobuf wire format: field 19 (StreamerContext) > field 2 (poToken)
 */
export function extractPoTokenFromBody(body: number[]): string | null {
  const buf = new Uint8Array(body);
  let offset = 0;

  function readVarint(off: number) {
    let value = 0;
    let shift = 0;
    while (off < buf.byteLength) {
      const byte = buf[off++];
      value |= (byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        break;
      }

      shift += 7;
    }
    return { value: value >>> 0, offset: off };
  }

  // Find field 19 (StreamerContext) - tag = (19 << 3) | 2 = 154
  while (offset < buf.byteLength) {
    const tag = readVarint(offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;
    if (wireType === 2) {
      const len = readVarint(offset);
      offset = len.offset;

      if (fieldNumber === 19) {
        // Parse StreamerContext for field 2 (poToken)
        const ctxData = buf.subarray(offset, offset + len.value);
        let ctxOffset = 0;

        while (ctxOffset < ctxData.byteLength) {
          const ctxTag = readVarint(ctxOffset);
          ctxOffset = ctxTag.offset;
          const ctxField = ctxTag.value >> 3;
          const ctxWire = ctxTag.value & 0x7;
          if (ctxWire === 2) {
            const ctxLen = readVarint(ctxOffset);
            ctxOffset = ctxLen.offset;

            if (ctxField === 2 && ctxLen.value > 0) {
              const poTokenBytes = ctxData.subarray(ctxOffset, ctxOffset + ctxLen.value);
              return btoa(String.fromCharCode(...poTokenBytes));
            }

            ctxOffset += ctxLen.value;
          } else if (ctxWire === 0) {
            ctxOffset = readVarint(ctxOffset).offset;
          } else {
            break;
          }
        }
      }

      offset += len.value;
    } else if (wireType === 0) {
      offset = readVarint(offset).offset;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }

  return null;
}

/** Debug: returns all captured tab IDs. */
export function getDebugCaptureState() {
  return {
    capturedTabIds: [...capturedByTab.keys()],
    sizes: [...capturedByTab.entries()].map(([id, d]) => ({ tabId: id, bodySize: d.body.length }))
  };
}

/**
 * Clears captured data for a tab (on navigation or tab close).
 */
export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
}
