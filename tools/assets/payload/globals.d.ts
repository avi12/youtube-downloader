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

declare let browser: HmrExtensionApi | undefined;
declare let chrome: HmrExtensionApi | undefined;
declare let ytdlDevHmr: {
  createHotContext: (moduleId: string) => unknown;
  state: Record<string, (...args: never[]) => unknown>;
} | undefined;
declare let ytdlDevHmrEntry: string | undefined;
// Set by background-prelude.js in the extension background: undoes the running copy's registrations
declare let ytdlDevBackground: {
  teardown: () => number;
  // Set by the background swap after a swap, to tell a swapped background from a restarted one
  version?: string;
} | undefined;
// Prepended by the dev server from the serde struct PayloadConfig
declare const HMR_CONFIG: PayloadConfig;
