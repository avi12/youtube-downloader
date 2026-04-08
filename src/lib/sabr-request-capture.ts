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
    { urls: ["https://*.googlevideo.com/videoplayback*"] },
    ["requestBody"]
  );
}

let onCaptureCallback: ((tabId: number) => void) | null = null;

/** Registers a callback invoked the first time a SABR body is captured per tab. */
export function onSabrBodyCaptured(callback: (tabId: number) => void) {
  onCaptureCallback = callback;
}

function handleSabrRequest(details: Browser.webRequest.OnBeforeRequestDetails) {
  if (details.tabId < 0) {
    return undefined;
  }

  if (!details.requestBody?.raw?.[0]?.bytes) {
    return undefined;
  }

  const bodyBytes = new Uint8Array(details.requestBody.raw[0].bytes);
  const previousData = capturedByTab.get(details.tabId);
  const isFirstCapture = !previousData;

  // Always save the latest SABR request body. The PO token evolves during
  // the session, so the latest body has the most valid token.
  capturedByTab.set(details.tabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: details.tabId,
    timestamp: Date.now()
  });

  // Notify on first capture, AND whenever a PO token is first found.
  // The initial SABR handshake has no PO token - it only appears in
  // subsequent requests once the player starts streaming.
  const hadPoTokenBefore = previousData
    ? Boolean(extractPoTokenFromBody(previousData.body))
    : false;

  const hasPoTokenNow = Boolean(extractPoTokenFromBody(Array.from(bodyBytes)));
  const isNewPoToken = hasPoTokenNow && !hadPoTokenBefore;
  if (isFirstCapture || isNewPoToken) {
    onCaptureCallback?.(details.tabId);
  }
}

/**
 * Returns the captured SABR request data for a given tab.
 * Falls back to the most recent capture from any tab when the
 * requesting tab has no data (e.g. channel pages with no player).
 */
export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? getLatestCapturedSabrData();
}

/**
 * Returns the most recently captured SABR data across all tabs.
 * Used as a fallback for tabs that never had a video player.
 */
function getLatestCapturedSabrData() {
  let latest: CapturedSabrData | null = null;

  for (const entry of capturedByTab.values()) {
    if (!latest || entry.timestamp > latest.timestamp) {
      latest = entry;
    }
  }

  return latest;
}

/**
 * Extracts just the PO token (base64) from a captured SABR request body.
 * The PO token is at: VideoPlaybackAbrRequest.streamerContext.poToken
 * In protobuf wire format: field 19 (StreamerContext) > field 2 (poToken)
 */
export function extractPoTokenFromBody(body: number[]) {
  const VARINT_DATA_BITS_MASK = 0x7f;
  const VARINT_CONTINUATION_BIT = 0x80;
  const VARINT_BITS_PER_BYTE = 7;
  const PROTO_FIELD_NUMBER_SHIFT = 3;
  const PROTO_WIRE_TYPE_MASK = 0x7;
  const WIRE_TYPE_VARINT = 0;
  const WIRE_TYPE_64_BIT = 1;
  const WIRE_TYPE_LENGTH_DELIMITED = 2;
  const WIRE_TYPE_32_BIT = 5;
  const WIRE_64_BIT_BYTE_SIZE = 8;
  const WIRE_32_BIT_BYTE_SIZE = 4;
  const FIELD_STREAMER_CONTEXT = 19;
  const FIELD_PO_TOKEN = 2;

  const buf = new Uint8Array(body);
  let offset = 0;

  function readVarint(off: number) {
    let value = 0;
    let shift = 0;
    while (off < buf.byteLength) {
      const byte = buf[off++];
      value |= (byte & VARINT_DATA_BITS_MASK) << shift;

      if ((byte & VARINT_CONTINUATION_BIT) === 0) {
        break;
      }

      shift += VARINT_BITS_PER_BYTE;
    }
    return {
      value: value >>> 0,
      offset: off
    };
  }

  function parseStreamerContext(ctxData: Uint8Array) {
    let ctxOffset = 0;
    while (ctxOffset < ctxData.byteLength) {
      const ctxTag = readVarint(ctxOffset);
      ctxOffset = ctxTag.offset;
      const ctxField = ctxTag.value >> PROTO_FIELD_NUMBER_SHIFT;
      const ctxWire = ctxTag.value & PROTO_WIRE_TYPE_MASK;
      if (ctxWire === WIRE_TYPE_VARINT) {
        ctxOffset = readVarint(ctxOffset).offset;
        continue;
      }

      if (ctxWire !== WIRE_TYPE_LENGTH_DELIMITED) {
        break;
      }

      const ctxLen = readVarint(ctxOffset);
      ctxOffset = ctxLen.offset;

      if (ctxField === FIELD_PO_TOKEN && ctxLen.value > 0) {
        const poTokenBytes = ctxData.subarray(ctxOffset, ctxOffset + ctxLen.value);
        return btoa(String.fromCharCode(...poTokenBytes));
      }

      ctxOffset += ctxLen.value;
    }
    return null;
  }

  // Find field 19 (StreamerContext) - tag = (19 << 3) | 2 = 154
  while (offset < buf.byteLength) {
    const tag = readVarint(offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const wireType = tag.value & PROTO_WIRE_TYPE_MASK;
    if (wireType === WIRE_TYPE_VARINT) {
      offset = readVarint(offset).offset;
      continue;
    }

    if (wireType === WIRE_TYPE_64_BIT) {
      offset += WIRE_64_BIT_BYTE_SIZE;
      continue;
    }

    if (wireType === WIRE_TYPE_32_BIT) {
      offset += WIRE_32_BIT_BYTE_SIZE;
      continue;
    }

    if (wireType !== WIRE_TYPE_LENGTH_DELIMITED) {
      break;
    }

    const len = readVarint(offset);
    offset = len.offset;

    if (fieldNumber === FIELD_STREAMER_CONTEXT) {
      const poToken = parseStreamerContext(buf.subarray(offset, offset + len.value));
      if (poToken) {
        return poToken;
      }
    }

    offset += len.value;
  }

  return null;
}

/** Debug: returns all captured tab IDs. */
export function getDebugCaptureState() {
  return {
    capturedTabIds: [...capturedByTab.keys()],
    sizes: [...capturedByTab.entries()].map(([id, d]) => ({
      tabId: id,
      bodySize: d.body.length
    }))
  };
}

/**
 * Clears captured data for a tab (on navigation or tab close).
 */
export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
}
