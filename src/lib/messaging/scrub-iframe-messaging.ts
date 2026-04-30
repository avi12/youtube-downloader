// Long-lived port channel between BG-hosted scrub iframes and the BG
// orchestrator. The iframe's ISOLATED-world content script opens a port via
// browser.runtime.connect(); BG listens for matching ports through
// browser.runtime.onConnect. Mirrors the offscreen-messaging pattern in
// `offscreen-messaging.ts`.
//
// Why a port instead of one-shot runtime.sendMessage:
//   - Long-lived ports survive across the iframe's lifecycle and don't race
//     with the BG service worker idle teardown (Firefox event-page model).
//   - Sender info (port.sender) carries frameId/tabId so the orchestrator
//     can match incoming segments to specific iframes when needed.
//   - BG can post diagnostics back to the iframe through the same port
//     without needing a separate handler.

const SCRUB_IFRAME_PORT_NAME = "ytdl-scrub-iframe";

const ScrubIframeMessageType = {
  Hello: "hello",
  Debug: "debug",
  Segment: "segment"
} as const;

type ScrubIframeMessageType = (typeof ScrubIframeMessageType)[keyof typeof ScrubIframeMessageType];

interface ScrubIframeProtocolMap {
  [ScrubIframeMessageType.Hello]: {
    videoId: string;
    scrubIndex: number;
  };
  [ScrubIframeMessageType.Debug]: {
    msg: string;
  };
  [ScrubIframeMessageType.Segment]: {
    videoId: string;
    scrubIndex: number;
    videoBase64: string;
    audioBase64: string;
    videoMimeType: string;
    audioMimeType: string;
    videoBufferStartSec?: number;
    videoBufferEndSec?: number;
  };
}

type ScrubIframeMessage = {
  [T in ScrubIframeMessageType]: {
    type: T;
    data: ScrubIframeProtocolMap[T];
  };
}[ScrubIframeMessageType];

type ScrubIframeHandler<T extends ScrubIframeMessageType> = (
  data: ScrubIframeProtocolMap[T],
  port: Browser.runtime.Port
) => void;

type ScrubIframeHandlerMap = { [T in ScrubIframeMessageType]?: ScrubIframeHandler<T> };

let cachedPort: Browser.runtime.Port | null = null;

function getScrubIframePort() {
  if (!cachedPort) {
    cachedPort = browser.runtime.connect({ name: SCRUB_IFRAME_PORT_NAME });
    cachedPort.onDisconnect.addListener(() => {
      cachedPort = null;
    });
  }

  return cachedPort;
}

function sendScrubIframeMessage<T extends ScrubIframeMessageType>(
  type: T,
  data: ScrubIframeProtocolMap[T]
) {
  getScrubIframePort().postMessage({
    type,
    data
  });
}

function dispatchScrubIframeMessage({ handlers, message, port }: {
  handlers: ScrubIframeHandlerMap;
  message: ScrubIframeMessage;
  port: Browser.runtime.Port;
}) {
  switch (message.type) {
    case ScrubIframeMessageType.Hello:
      handlers[ScrubIframeMessageType.Hello]?.(message.data, port);
      break;
    case ScrubIframeMessageType.Debug:
      handlers[ScrubIframeMessageType.Debug]?.(message.data, port);
      break;
    case ScrubIframeMessageType.Segment:
      handlers[ScrubIframeMessageType.Segment]?.(message.data, port);
      break;
  }
}

function listenForScrubIframeMessages(handlers: ScrubIframeHandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== SCRUB_IFRAME_PORT_NAME) {
      return;
    }

    port.onMessage.addListener((message: ScrubIframeMessage) => {
      dispatchScrubIframeMessage({
        handlers,
        message,
        port
      });
    });
  });
}

export {
  ScrubIframeMessageType,
  SCRUB_IFRAME_PORT_NAME,
  sendScrubIframeMessage,
  listenForScrubIframeMessages
};
