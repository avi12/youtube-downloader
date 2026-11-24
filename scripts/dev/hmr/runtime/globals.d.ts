// The extension API and dev globals as the in-browser runtimes (runtime.ts, background-prelude.ts) see them
interface HmrExtensionApi {
  runtime: {
    id?: string;
    getURL: (path: string) => string;
  };
}

declare var browser: HmrExtensionApi | undefined;
declare var chrome: HmrExtensionApi | undefined;
declare var ytdlDevHmr: {
  createHotContext: (moduleId: string) => unknown;
  state: Record<string, (...args: never[]) => unknown>;
} | undefined;
declare var ytdlDevHmrEntry: string | undefined;
// Set by background-prelude.ts in the extension background: undoes the running copy's registrations
declare var ytdlDevBackground: {
  teardown: () => number;
  // Set by browsers/background-swap.ts after a swap, to tell a swapped background from a restarted one
  version?: string;
} | undefined;
