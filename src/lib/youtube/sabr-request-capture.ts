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
  browser.tabs.onRemoved.addListener(tabId => capturedByTab.delete(tabId));
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
      const byte = buf[off];
      off++;
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

const PREFERRED_AUDIO_FORMAT_IDS_FIELD = 16;
const PREFERRED_VIDEO_FORMAT_IDS_FIELD = 17;

export function dumpFieldBytes(body: number[], targetField: number, maxEntries = 3) {
  const buf = new Uint8Array(body);
  let offset = 0;
  const hits: string[] = [];

  while (offset < buf.byteLength && hits.length < maxEntries) {
    let value = 0;
    let shift = 0;
    while (offset < buf.byteLength) {
      const byte = buf[offset];
      offset++;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }

      shift += 7;
    }

    const fieldNumber = value >>> 3;
    const wireType = value & 0x7;

    if (wireType === 0) {
      while (offset < buf.byteLength && (buf[offset] & 0x80) !== 0) {
        offset++;
      }

      offset++;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 2) {
      let len = 0;
      let lshift = 0;
      while (offset < buf.byteLength) {
        const byte = buf[offset];
        offset++;
        len |= (byte & 0x7f) << lshift;
        if ((byte & 0x80) === 0) {
          break;
        }

        lshift += 7;
      }

      if (fieldNumber === targetField) {
        hits.push(Array.from(buf.subarray(offset, offset + Math.min(len, 32)))
          .map(b => b.toString(16).padStart(2, "0")).join(" "));
      }

      offset += len;
    } else {
      break;
    }
  }

  return hits;
}

export function inspectTopLevelFields(body: number[]) {
  const buf = new Uint8Array(body);
  let offset = 0;
  const fieldCounts: Record<number, number> = {};

  while (offset < buf.byteLength) {
    let value = 0;
    let shift = 0;
    while (offset < buf.byteLength) {
      const byte = buf[offset];
      offset++;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }

      shift += 7;
    }

    const fieldNumber = value >>> 3;
    const wireType = value & 0x7;
    fieldCounts[fieldNumber] = (fieldCounts[fieldNumber] ?? 0) + 1;

    if (wireType === 0) {
      while (offset < buf.byteLength && (buf[offset] & 0x80) !== 0) {
        offset++;
      }

      offset++;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 2) {
      let len = 0;
      let lshift = 0;
      while (offset < buf.byteLength) {
        const byte = buf[offset];
        offset++;
        len |= (byte & 0x7f) << lshift;
        if ((byte & 0x80) === 0) {
          break;
        }

        lshift += 7;
      }

      offset += len;
    } else {
      break;
    }
  }

  return fieldCounts;
}

function readVarintFromBuffer(buf: Uint8Array, off: number) {
  let value = 0;
  let shift = 0;
  while (off < buf.byteLength) {
    const byte = buf[off];
    off++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;
  }
  return {
    value: value >>> 0,
    offset: off
  };
}

function readItagFromFormatIdMessage(data: Uint8Array) {
  let ctxOffset = 0;
  while (ctxOffset < data.byteLength) {
    const tag = readVarintFromBuffer(data, ctxOffset);
    ctxOffset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;
    if (wireType === 0) {
      const val = readVarintFromBuffer(data, ctxOffset);
      if (fieldNumber === 1) {
        return val.value;
      }

      ctxOffset = val.offset;
    } else if (wireType === 1) {
      ctxOffset += 8;
    } else if (wireType === 5) {
      ctxOffset += 4;
    } else if (wireType === 2) {
      const len = readVarintFromBuffer(data, ctxOffset);
      ctxOffset = len.offset + len.value;
    } else {
      break;
    }
  }
  return null;
}

export function extractPreferredFormatItagsFromBody(body: number[]) {
  const buf = new Uint8Array(body);
  let offset = 0;
  const video: number[] = [];
  const audio: number[] = [];

  while (offset < buf.byteLength) {
    const tag = readVarintFromBuffer(buf, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> 3;
    const wireType = tag.value & 0x7;
    if (wireType === 0) {
      offset = readVarintFromBuffer(buf, offset).offset;
      continue;
    }

    if (wireType === 1) {
      offset += 8;
      continue;
    }

    if (wireType === 5) {
      offset += 4;
      continue;
    }

    if (wireType !== 2) {
      break;
    }

    const len = readVarintFromBuffer(buf, offset);
    offset = len.offset;

    if (fieldNumber === PREFERRED_AUDIO_FORMAT_IDS_FIELD || fieldNumber === PREFERRED_VIDEO_FORMAT_IDS_FIELD) {
      const itag = readItagFromFormatIdMessage(buf.subarray(offset, offset + len.value));
      if (itag !== null) {
        if (fieldNumber === PREFERRED_VIDEO_FORMAT_IDS_FIELD) {
          video.push(itag);
        } else {
          audio.push(itag);
        }
      }
    }

    offset += len.value;
  }

  return { video, audio };
}
