const SABR_STALL_TIMEOUT_MS = 10_000;
const SABR_FIRST_BYTE_TIMEOUT_MS = 5_000;

export function createSabrStallTimer(parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), SABR_FIRST_BYTE_TIMEOUT_MS);
  parentSignal.addEventListener("abort", () => controller.abort(), { once: true });

  function onProgress() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), SABR_STALL_TIMEOUT_MS);
  }

  function cleanup() {
    clearTimeout(timeoutId);
  }

  return {
    signal: controller.signal,
    onProgress,
    cleanup
  };
}
