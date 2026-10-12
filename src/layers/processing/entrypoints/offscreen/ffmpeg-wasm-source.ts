import { FFmpegCoreBuild } from "@/lib/download-pipeline/mux-worker-types";
import { browser } from "#imports";

const BUNDLED_WASM_PATH = "/ffmpeg/ffmpeg-core.wasm";

// @ffmpeg/core 0.12.1+ is built with -msimd128, which V8 and SpiderMonkey only run
// on CPUs with SSE4.1. Those get 0.12.0, the last release built without SIMD,
// fetched from the CDN so it doesn't double the bundle size (issue #21). Its glue
// is the bundled @ffmpeg/core-nosimd alias, patched with WORKERFS like 0.12.1+
const NO_SIMD_WASM_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.0/dist/esm/ffmpeg-core.wasm";
const NO_SIMD_WASM_SHA256 = "0a24129334f7f7afd411f2b41aca49009434fe5c31b934908b82888ba0956c03";
const NO_SIMD_OPFS_FILENAME = "ffmpeg-core-nosimd.wasm";

// Smallest module using SIMD opcodes (i8x16.splat + i8x16.popcnt), from wasm-feature-detect
const SIMD_PROBE_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
]);

export function resolveFFmpegCoreBuild() {
  return WebAssembly.validate(SIMD_PROBE_MODULE) ? FFmpegCoreBuild.Simd : FFmpegCoreBuild.NoSimd;
}

async function fetchBundledWasm() {
  const response = await fetch(browser.runtime.getURL(BUNDLED_WASM_PATH));
  return response.arrayBuffer();
}

async function isNoSimdWasmIntact(wasmBinary: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", wasmBinary));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  return hex === NO_SIMD_WASM_SHA256;
}

async function readCachedNoSimdWasm() {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(NO_SIMD_OPFS_FILENAME);
  return (await fileHandle.getFile()).arrayBuffer();
}

async function cacheNoSimdWasm(wasmBinary: ArrayBuffer) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(NO_SIMD_OPFS_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(wasmBinary);
  await writable.close();
}

async function downloadNoSimdWasm() {
  const response = await fetch(NO_SIMD_WASM_URL);
  if (!response.ok) {
    throw new Error(`Non-SIMD FFmpeg core download failed: HTTP ${response.status}`);
  }

  const wasmBinary = await response.arrayBuffer();
  if (!await isNoSimdWasmIntact(wasmBinary)) {
    throw new Error("Non-SIMD FFmpeg core failed its integrity check");
  }

  await cacheNoSimdWasm(wasmBinary).catch(() => {});
  return wasmBinary;
}

async function fetchNoSimdWasm() {
  const cachedWasmBinary = await readCachedNoSimdWasm().catch(() => null);
  const isCacheIntact = cachedWasmBinary !== null && await isNoSimdWasmIntact(cachedWasmBinary);
  if (isCacheIntact) {
    return cachedWasmBinary;
  }

  return downloadNoSimdWasm();
}

const FFMPEG_CORE_WASM: Record<FFmpegCoreBuild, () => Promise<ArrayBuffer>> = {
  [FFmpegCoreBuild.Simd]: fetchBundledWasm,
  [FFmpegCoreBuild.NoSimd]: fetchNoSimdWasm
};

export function fetchFFmpegCoreWasm(coreBuild: FFmpegCoreBuild) {
  return FFMPEG_CORE_WASM[coreBuild]();
}
