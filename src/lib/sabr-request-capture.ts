const capturedByTab = new Map<number, {
  body: number[];
  url: string;
  tabId: number;
  timestamp: number;
}>();

export function startSabrRequestCapture() {
  browser.webRequest.onBeforeRequest.addListener(
    handleSabrRequest,
    { urls: ["https://*.googlevideo.com/videoplayback*"] },
    ["requestBody"]
  );
}

let onCaptureCallback: ((tabId: number) => void) | null = null;

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

  // The PO token evolves during the session, so the latest body has the most valid token.
  capturedByTab.set(details.tabId, {
    body: Array.from(bodyBytes),
    url: details.url,
    tabId: details.tabId,
    timestamp: Date.now()
  });

  // The initial SABR handshake has no PO token; it only appears once the player starts streaming,
  // so also notify on first-seen PO token.
  const isPreviousPoToken = previousData
    ? Boolean(extractPoTokenFromBody(previousData.body))
    : false;

  const isPoTokenPresent = Boolean(extractPoTokenFromBody(Array.from(bodyBytes)));
  const isNewPoToken = isPoTokenPresent && !isPreviousPoToken;
  if (isFirstCapture || isNewPoToken) {
    onCaptureCallback?.(details.tabId);
  }
}

// Falls back to the most recent capture from any tab when the requesting tab has no data
// (e.g., channel pages with no player).
export function getCapturedSabrData(tabId: number) {
  return capturedByTab.get(tabId) ?? getLatestCapturedSabrData();
}

function getLatestCapturedSabrData() {
  let latest: ReturnType<typeof capturedByTab.get>;

  for (const entry of capturedByTab.values()) {
    if (!latest || entry.timestamp > latest.timestamp) {
      latest = entry;
    }
  }

  return latest ?? null;
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

export function clearCapturedSabrData(tabId: number) {
  capturedByTab.delete(tabId);
}
