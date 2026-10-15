import { FFmpegCoreBuild } from "./mux-worker-types";

// Smallest module using SIMD opcodes (i8x16.splat + i8x16.popcnt), from wasm-feature-detect
const SIMD_PROBE_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
]);

export function resolveFFmpegCoreBuild() {
  return WebAssembly.validate(SIMD_PROBE_MODULE) ? FFmpegCoreBuild.Simd : FFmpegCoreBuild.NoSimd;
}
