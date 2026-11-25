// The extension API and dev globals as the in-browser payloads (runtime.js, background-prelude.js) see them.
// Not shipped: it only feeds the JSDoc type check.
interface HmrExtensionApi {
  runtime: {
    id?: string;
    getURL: (path: string) => string;
  };
}

interface PayloadConfig {
  manifestPath: string;
  pollIntervalMs: number;
}

declare var browser: HmrExtensionApi | undefined;
declare var chrome: HmrExtensionApi | undefined;
declare var ytdlDevHmr: {
  createHotContext: (moduleId: string) => unknown;
  state: Record<string, (...args: never[]) => unknown>;
} | undefined;
declare var ytdlDevHmrEntry: string | undefined;
// Set by background-prelude.js in the extension background: undoes the running copy's registrations
declare var ytdlDevBackground: {
  teardown: () => number;
  // Set by the background swap after a swap, to tell a swapped background from a restarted one
  version?: string;
} | undefined;
// The message handlers the content script's current run registered, removed before it restarts
declare var ytdlDevRunDisposers: (() => void)[] | undefined;
// The context of the content script's current run
declare var ytdlDevContentContext: { notifyInvalidated: () => void } | undefined;
// Prepended by the dev server from the serde struct PayloadConfig
declare const HMR_CONFIG: PayloadConfig;
