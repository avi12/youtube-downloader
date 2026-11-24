import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";

const MILLISECONDS_PER_SECOND = 1000;
const BUSY_FILE_ERROR_CODE = "EBUSY";

export function logEvent(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

const SECONDS_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export function formatElapsed(elapsedMs: number) {
  return `${SECONDS_FORMAT.format(elapsedMs / MILLISECONDS_PER_SECOND)}s`;
}

// ── Process diagnostics ─────────────────────────────────────────────────────

// WXT's in-process Vite server can reject with EBUSY when its watcher touches a file the browser
// holds locked; the build itself still succeeds. Anything else is logged and the session kept alive,
// so one transient browser hiccup never takes the dev server down.
export function installProcessDiagnostics() {
  process.on("unhandledRejection", reason => {
    const isViteWatcherEbusy = reason instanceof Error && "code" in reason && reason.code === BUSY_FILE_ERROR_CODE;
    if (isViteWatcherEbusy) {
      return;
    }

    logEvent("Unhandled rejection - dev server kept alive:");
    console.error(reason);
  });
  process.on("uncaughtException", error => {
    logEvent("Uncaught exception - dev server kept alive:");
    console.error(error);
  });
}

// ── Launch ──────────────────────────────────────────────────────────────────

// Suppress noisy web-ext-run logs
export function quietWebExtLogs() {
  const WARN_LOG_LEVEL = 40;
  webExtConsoleStream.write = ({ level, msg: message }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };
}
